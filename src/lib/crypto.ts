/**
 * App-level envelope encryption for sensitive values at rest (data-at-rest
 * protection). A DB read — backup leak, compromised DATABASE_URL, raw SQL
 * access — must not directly yield live Meta credentials.
 *
 * Scheme: AES-256-GCM (authenticated encryption).
 *  - Key: 32 bytes, sourced from APP_ENCRYPTION_KEY (base64), never hardcoded.
 *    Generate with:  openssl rand -base64 32
 *  - Per-message random 96-bit IV (NIST SP 800-38D recommended GCM nonce size).
 *  - The 128-bit GCM auth tag is stored alongside the ciphertext and verified
 *    on decrypt, so tampered ciphertext fails loudly instead of returning
 *    garbage.
 *
 * On-disk format (single self-describing blob, so we never store the key):
 *
 *     enc:v1:<base64( iv[12] | authTag[16] | ciphertext )>
 *
 * The `enc:v1:` prefix lets callers distinguish an encrypted blob from a
 * plaintext sentinel (e.g. an access_token of "" / "pending") or a legacy
 * not-yet-migrated row, and leaves room to rotate the scheme later.
 *
 * Server-only. Importing this in client code will throw (node:crypto).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit GCM nonce (recommended)
const AUTH_TAG_BYTES = 16; // 128-bit GCM tag
const PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;

/**
 * Resolve and cache the 32-byte encryption key from APP_ENCRYPTION_KEY.
 * Throws a clear, actionable error if the key is missing or malformed — we
 * fail closed rather than silently storing plaintext.
 */
function getKey(): Buffer {
	if (cachedKey) return cachedKey;

	const raw = process.env.APP_ENCRYPTION_KEY?.trim();
	if (!raw) {
		throw new Error(
			"APP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to your environment.",
		);
	}

	const key = Buffer.from(raw, "base64");
	if (key.length !== KEY_BYTES) {
		throw new Error(
			`APP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate a valid key with \`openssl rand -base64 32\`.`,
		);
	}

	cachedKey = key;
	return key;
}

/** True if `value` is an encrypted blob produced by `encryptSecret`. */
export function isEncrypted(value: string): boolean {
	return value.startsWith(PREFIX);
}

/**
 * Encrypt a plaintext secret. Always returns an `enc:v1:` blob. Callers that
 * may pass non-secret sentinels (e.g. access_token "pending") should use
 * `encryptToken` instead.
 */
export function encryptSecret(plaintext: string): string {
	const key = getKey();
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();
	return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypt an `enc:v1:` blob produced by `encryptSecret`. Throws if the value
 * is not an encrypted blob or if the GCM auth tag fails (tampered ciphertext /
 * wrong key) — never returns unauthenticated plaintext.
 */
export function decryptSecret(value: string): string {
	if (!isEncrypted(value)) {
		throw new Error("decryptSecret: value is not an encrypted blob");
	}

	const key = getKey();
	const blob = Buffer.from(value.slice(PREFIX.length), "base64");

	const iv = blob.subarray(0, IV_BYTES);
	const authTag = blob.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
	const ciphertext = blob.subarray(IV_BYTES + AUTH_TAG_BYTES);

	if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
		throw new Error("decryptSecret: malformed ciphertext blob");
	}

	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);
	// `.final()` throws if the auth tag doesn't verify.
	return Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]).toString("utf8");
}

// ============================================================
// access_token helpers — sentinel-aware
// ============================================================
//
// `platform_accounts.access_token` carries non-secret sentinel values that the
// rest of the app (and SQL) treats literally:
//   - ""        → disconnected (see /api/accounts/[id] DELETE)
//   - "pending" → placeholder, never connected (see meta-discovery cleanup)
//   - "mock-*"  → local/dev fixtures (see isConnected in /api/accounts)
// These are not secrets, so we leave them as plaintext; encrypting them would
// break the literal comparisons in stats/meta-discovery/accounts.

const TOKEN_SENTINELS: ReadonlySet<string> = new Set(["", "pending"]);

/** True if `value` is a non-secret access_token sentinel, not a real token. */
export function isTokenSentinel(value: string): boolean {
	return TOKEN_SENTINELS.has(value) || value.startsWith("mock-");
}

/**
 * Encrypt an access_token for storage. Sentinels pass through unchanged so the
 * literal SQL/`isConnected` checks keep working; real tokens are encrypted.
 */
export function encryptToken(plaintext: string): string {
	if (isTokenSentinel(plaintext)) return plaintext;
	return encryptSecret(plaintext);
}

/**
 * Decrypt an access_token read from storage. Encrypted blobs are decrypted;
 * sentinels and legacy not-yet-migrated plaintext pass through unchanged.
 * Returns null/undefined inputs as-is.
 */
export function decryptToken<T extends string | null | undefined>(value: T): T {
	if (value == null) return value;
	if (!isEncrypted(value)) return value;
	return decryptSecret(value) as T;
}
