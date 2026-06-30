import { describe, expect, it } from "vitest";
import { createAutomationSchema } from "./automation";

const UUID = "11111111-1111-4111-8111-111111111111";

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

describe("createAutomationSchema per-post targeting", () => {
	it("accepts a post id on an account-specific automation", () => {
		const result = createAutomationSchema.safeParse({
			name: "x",
			keywords: ["guide"],
			platform_account_id: UUID,
			platform_post_id: "post-123",
		});
		expect(result.success).toBe(true);
	});

	it("accepts a null / omitted post id (all posts)", () => {
		expect(
			createAutomationSchema.safeParse({
				name: "x",
				keywords: ["guide"],
				platform_account_id: UUID,
				platform_post_id: null,
			}).success,
		).toBe(true);
		expect(
			createAutomationSchema.safeParse({
				name: "x",
				keywords: ["guide"],
				platform_account_id: UUID,
			}).success,
		).toBe(true);
	});

	it("rejects a post id paired with a platform-wide scope", () => {
		const result = createAutomationSchema.safeParse({
			name: "x",
			keywords: ["guide"],
			scope: "meta",
			platform_post_id: "post-123",
		});
		expect(result.success).toBe(false);
	});

	it("rejects an empty-string post id", () => {
		const result = createAutomationSchema.safeParse({
			name: "x",
			keywords: ["guide"],
			platform_account_id: UUID,
			platform_post_id: "",
		});
		expect(result.success).toBe(false);
	});
});
