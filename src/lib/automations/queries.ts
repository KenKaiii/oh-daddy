import { getDb } from "@/lib/db";
import type { CommentAutomationRow } from "@/types/db";

/** A comment_automations row with its joined account (null for scope-wide). */
export interface AutomationWithAccount extends CommentAutomationRow {
	platform_account: {
		id: string;
		platform: string;
		account_name: string;
	} | null;
}

/**
 * List automations, optionally filtered to one account, each with its joined
 * platform_account (replaces the PostgREST embedded select).
 */
export async function listAutomations(
	accountId: string | null,
): Promise<AutomationWithAccount[]> {
	const sql = getDb();
	const where = accountId
		? sql`WHERE a.platform_account_id = ${accountId}`
		: sql``;
	return sql<AutomationWithAccount[]>`
		SELECT a.*,
			CASE WHEN pa.id IS NOT NULL
				THEN json_build_object('id', pa.id, 'platform', pa.platform, 'account_name', pa.account_name)
				ELSE NULL END AS platform_account
		FROM comment_automations a
		LEFT JOIN platform_accounts pa ON pa.id = a.platform_account_id
		${where}
		ORDER BY a.created_at DESC`;
}

/** Fetch a single automation (joined) by id, or null. */
export async function getAutomationById(
	id: string,
): Promise<AutomationWithAccount | null> {
	const sql = getDb();
	const rows = await sql<AutomationWithAccount[]>`
		SELECT a.*,
			CASE WHEN pa.id IS NOT NULL
				THEN json_build_object('id', pa.id, 'platform', pa.platform, 'account_name', pa.account_name)
				ELSE NULL END AS platform_account
		FROM comment_automations a
		LEFT JOIN platform_accounts pa ON pa.id = a.platform_account_id
		WHERE a.id = ${id}`;
	return rows[0] ?? null;
}
