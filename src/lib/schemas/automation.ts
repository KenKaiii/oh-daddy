import { z } from "zod";

/**
 * Platform-wide scope a comment automation can target instead of a specific
 * account. MVP supports only `meta` (all FB Pages + IG accounts share the
 * Graph API surface). Mirror of the DB CHECK constraint.
 */
export const automationScopeSchema = z.enum(["meta"]);
export type AutomationScope = z.infer<typeof automationScopeSchema>;

/**
 * Hostnames permitted in `dm_link`. The value is auto-appended to DMs that the
 * automation sends — via the operator's verified Meta token — to third-party
 * users who comment (see `src/lib/automations/run-automation.ts`). An
 * unconstrained URL therefore turns the victim's account into a phishing relay
 * (security finding BP-002), so we restrict it to an allowlist.
 *
 * Configure with `DM_LINK_ALLOWED_HOSTS` (comma-separated hostnames, e.g.
 * `acme.com,links.acme.com`). When unset we fall back to the app's own host
 * (`NEXT_PUBLIC_APP_URL`). If neither is configured, every link is rejected
 * (fail closed). A leading `www.` is ignored and subdomains of an allowed host
 * are accepted.
 */
export function getDmLinkAllowedHosts(): string[] {
	const raw = process.env.DM_LINK_ALLOWED_HOSTS?.trim();
	if (raw) {
		return raw
			.split(",")
			.map((h) =>
				h
					.trim()
					.toLowerCase()
					.replace(/^www\./, ""),
			)
			.filter(Boolean);
	}
	const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
	if (appUrl) {
		try {
			return [new URL(appUrl).hostname.toLowerCase().replace(/^www\./, "")];
		} catch {
			return [];
		}
	}
	return [];
}

function isAllowedDmLink(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	// Links are sent to real users; require TLS and reject anything else.
	if (url.protocol !== "https:") return false;
	const host = url.hostname.toLowerCase().replace(/^www\./, "");
	return getDmLinkAllowedHosts().some(
		(allowed) => host === allowed || host.endsWith(`.${allowed}`),
	);
}

/**
 * `dm_link` validator shared by create + update. A valid https URL whose host
 * is on the allowlist, or null/omitted to send no link.
 */
const dmLinkSchema = z
	.string()
	.url()
	.refine(isAllowedDmLink, {
		message:
			"dm_link host is not allowed. Add it to DM_LINK_ALLOWED_HOSTS (https only).",
	})
	.nullable()
	.optional();

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
	dm_link: dmLinkSchema,
	is_active: z.boolean().optional().default(true),
};

export const createAutomationSchema = z
	.object({
		...baseAutomationFields,
		platform_account_id: z.string().uuid().nullable().optional(),
		scope: automationScopeSchema.nullable().optional(),
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
	);
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;

export const updateAutomationSchema = z
	.object({
		name: z.string().min(1).optional(),
		keywords: z.array(z.string().min(1)).min(1).optional(),
		fuzzy_threshold: z.number().int().min(0).max(5).optional(),
		comment_replies: z.array(z.string().min(1)).optional(),
		dm_message: z.string().optional(),
		dm_link: dmLinkSchema,
		is_active: z.boolean().optional(),
		platform_account_id: z.string().uuid().nullable().optional(),
		scope: automationScopeSchema.nullable().optional(),
	})
	.partial();
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;
