import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAutomationSchema, getDmLinkAllowedHosts } from "./automation";

const UUID = "11111111-1111-4111-8111-111111111111";

/** Minimal valid create payload; override dm_link per test. */
function payload(dm_link: string | null | undefined) {
	return {
		name: "Lead magnet",
		keywords: ["guide"],
		platform_account_id: UUID,
		dm_link,
	};
}

function parseLink(dm_link: string | null | undefined) {
	return createAutomationSchema.safeParse(payload(dm_link));
}

const ORIGINAL = { ...process.env };

beforeEach(() => {
	process.env.DM_LINK_ALLOWED_HOSTS = "acme.com,links.acme.com";
	delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
	process.env = { ...ORIGINAL };
});

describe("getDmLinkAllowedHosts", () => {
	it("parses a comma list, lowercasing and stripping www.", () => {
		process.env.DM_LINK_ALLOWED_HOSTS = "ACME.com, www.Foo.io ";
		expect(getDmLinkAllowedHosts()).toEqual(["acme.com", "foo.io"]);
	});

	it("falls back to the app host when no allowlist is set", () => {
		delete process.env.DM_LINK_ALLOWED_HOSTS;
		process.env.NEXT_PUBLIC_APP_URL = "https://www.myapp.dev";
		expect(getDmLinkAllowedHosts()).toEqual(["myapp.dev"]);
	});

	it("fails closed (empty) when neither env var is set", () => {
		delete process.env.DM_LINK_ALLOWED_HOSTS;
		delete process.env.NEXT_PUBLIC_APP_URL;
		expect(getDmLinkAllowedHosts()).toEqual([]);
	});
});

describe("createAutomationSchema dm_link allowlist", () => {
	it("accepts null / undefined (no link)", () => {
		expect(parseLink(null).success).toBe(true);
		expect(parseLink(undefined).success).toBe(true);
	});

	it("accepts an allowlisted https host", () => {
		expect(parseLink("https://acme.com/guide").success).toBe(true);
	});

	it("accepts a subdomain of an allowlisted host", () => {
		expect(parseLink("https://promo.acme.com/x").success).toBe(true);
	});

	it("ignores a leading www. on the link host", () => {
		expect(parseLink("https://www.acme.com/guide").success).toBe(true);
	});

	it("rejects http (TLS required)", () => {
		expect(parseLink("http://acme.com/guide").success).toBe(false);
	});

	it("rejects a host that is not on the allowlist", () => {
		expect(parseLink("https://evil.com/guide").success).toBe(false);
	});

	it("rejects a lookalike that only suffix-matches without a dot boundary", () => {
		// "notacme.com" must not be treated as a subdomain of "acme.com".
		expect(parseLink("https://notacme.com/x").success).toBe(false);
	});

	it("rejects every link when the allowlist is empty (fail closed)", () => {
		delete process.env.DM_LINK_ALLOWED_HOSTS;
		delete process.env.NEXT_PUBLIC_APP_URL;
		expect(parseLink("https://acme.com/guide").success).toBe(false);
	});
});

describe("createAutomationSchema account/scope XOR", () => {
	it("rejects when both platform_account_id and scope are set", () => {
		const result = createAutomationSchema.safeParse({
			name: "x",
			keywords: ["guide"],
			platform_account_id: UUID,
			scope: "meta",
		});
		expect(result.success).toBe(false);
	});

	it("accepts a platform-wide scope with no account", () => {
		const result = createAutomationSchema.safeParse({
			name: "x",
			keywords: ["guide"],
			scope: "meta",
		});
		expect(result.success).toBe(true);
	});

	it("rejects when neither account nor scope is set", () => {
		const result = createAutomationSchema.safeParse({
			name: "x",
			keywords: ["guide"],
		});
		expect(result.success).toBe(false);
	});
});
