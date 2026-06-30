import { z } from "zod";

/**
 * Platform-wide scope a comment automation can target instead of a specific
 * account. MVP supports only `meta` (all FB Pages + IG accounts share the
 * Graph API surface). Mirror of the DB CHECK constraint.
 */
export const automationScopeSchema = z.enum(["meta"]);
export type AutomationScope = z.infer<typeof automationScopeSchema>;

/**
 * Optional per-post targeting. A platform-side post id, or null/omitted to fire
 * on every post of the target account. Post-targeting is account-specific, so a
 * value is only valid when `platform_account_id` is set (enforced below).
 */
const platformPostIdSchema = z.string().min(1).nullable().optional();

/**
 * Form/API payload for create + edit. The DB enforces XOR between
 * `platform_account_id` and `scope`; we mirror that in zod via a refine so
 * callers get a clear error before hitting Postgres.
 */
const baseAutomationFields = {
	name: z.string().min(1, "Name is required"),
	keywords: z.array(z.string().min(1)).min(1, "At least one keyword required"),
	fuzzy_threshold: z.number().int().min(0).max(5).optional().default(2),
	comment_replies: z.array(z.string().min(1)).optional().default([]),
	dm_message: z.string().optional().default(""),
	is_active: z.boolean().optional().default(true),
};

export const createAutomationSchema = z
	.object({
		...baseAutomationFields,
		platform_account_id: z.string().uuid().nullable().optional(),
		scope: automationScopeSchema.nullable().optional(),
		platform_post_id: platformPostIdSchema,
	})
	.refine(
		(val) =>
			(val.platform_account_id != null && val.scope == null) ||
			(val.platform_account_id == null && val.scope != null),
		{
			message:
				"Pick either a specific account OR a platform-wide scope, not both.",
			path: ["scope"],
		},
	)
	.refine((val) => val.platform_post_id == null || val.scope == null, {
		message: "Per-post targeting requires a specific account, not a scope.",
		path: ["platform_post_id"],
	});
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;

export const updateAutomationSchema = z
	.object({
		name: z.string().min(1).optional(),
		keywords: z.array(z.string().min(1)).min(1).optional(),
		fuzzy_threshold: z.number().int().min(0).max(5).optional(),
		comment_replies: z.array(z.string().min(1)).optional(),
		dm_message: z.string().optional(),
		is_active: z.boolean().optional(),
		platform_account_id: z.string().uuid().nullable().optional(),
		scope: automationScopeSchema.nullable().optional(),
		platform_post_id: platformPostIdSchema,
	})
	.partial();
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;
