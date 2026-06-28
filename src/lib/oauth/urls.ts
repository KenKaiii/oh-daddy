import { META_SCOPES } from "@/lib/oauth/scopes";
import { getSettingsKey, requireSettingsKey } from "@/lib/settings";

// ============================================================
// PKCE utilities
// ============================================================

const PKCE_CODE_CHALLENGE_METHOD = "S256";
const PKCE_VERIFIER_LENGTH = 64;

function generateCodeVerifier(): string {
	const array = new Uint8Array(PKCE_VERIFIER_LENGTH);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return base64UrlEncode(new Uint8Array(hashBuffer));
}

function base64UrlEncode(array: Uint8Array): string {
	return btoa(String.fromCharCode(...array))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

// ============================================================
// Meta scopes (fallback when no config_id is set) — see ./scopes
// ============================================================

function generateState(): string {
	return crypto.randomUUID();
}

export interface AuthUrlResult {
	url: string;
	state: string;
	codeVerifier: string;
	codeChallenge: string;
}

/**
 * Build the Meta OAuth URL. Uses Facebook Login for Business (config_id) when
 * configured, otherwise falls back to the legacy scope + PKCE flow.
 */
export async function buildMetaAuthUrl(
	redirectUri: string,
): Promise<AuthUrlResult> {
	const state = generateState();
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);

	const metaAppId = await requireSettingsKey("meta_app_id");
	const configId = await getSettingsKey("meta_config_id");

	const params = new URLSearchParams({
		client_id: metaAppId,
		redirect_uri: redirectUri,
		response_type: "code",
		state,
	});

	if (configId) {
		// Facebook Login for Business — use config_id, override response type.
		params.set("config_id", configId);
		params.set("override_default_response_type", "true");
	} else {
		// Legacy flow — use scope + PKCE.
		params.set("scope", META_SCOPES.join(","));
		params.set("code_challenge", codeChallenge);
		params.set("code_challenge_method", PKCE_CODE_CHALLENGE_METHOD);
	}

	return {
		url: `https://www.facebook.com/v25.0/dialog/oauth?${params.toString()}`,
		state,
		codeVerifier,
		codeChallenge,
	};
}

/** Build an OAuth URL for the given (Meta-only) platform. */
export async function buildOAuthUrl(
	platform: "facebook" | "instagram",
	redirectUri: string,
): Promise<AuthUrlResult> {
	switch (platform) {
		case "facebook":
		case "instagram":
			return buildMetaAuthUrl(redirectUri);
		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}
}
