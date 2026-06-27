/**
 * Hand-written row interfaces for the 8 tables in `db/schema.sql`. Kept
 * minimal — only the columns the app reads/writes. Used to type the rows
 * returned by `getDb()` queries (porsager `postgres`).
 */

export type Json =
	| string
	| number
	| boolean
	| null
	| { [key: string]: Json | undefined }
	| Json[];

export type Platform = "facebook" | "instagram";
export type InteractionType = "comment" | "dm";
export type MessageRole = "user" | "assistant";
export type AutomationScope = "meta";

export type SettingRow = {
	provider: string;
	value: string;
	updated_at: string;
};

export type PlatformAccountRow = {
	id: string;
	platform: Platform;
	account_id: string;
	account_name: string;
	access_token: string;
	refresh_token: string | null;
	token_expires_at: string | null;
	metadata: Json;
	disconnected_at: string | null;
	created_at: string;
	updated_at: string;
};

export type ContactRow = {
	id: string;
	platform: Platform;
	platform_user_id: string;
	name: string | null;
	username: string | null;
	avatar_url: string | null;
	last_seen_at: string;
	created_at: string;
};

export type ConversationRow = {
	id: string;
	platform_account_id: string;
	contact_id: string;
	interaction_type: InteractionType;
	platform_thread_id: string;
	platform_post_id: string | null;
	last_message_at: string;
	created_at: string;
};

export type MessageRow = {
	id: string;
	conversation_id: string;
	role: MessageRole;
	content: string;
	platform_message_id: string | null;
	metadata: Json;
	created_at: string;
};

export type CommentAutomationRow = {
	id: string;
	platform_account_id: string | null;
	scope: AutomationScope | null;
	name: string;
	is_active: boolean;
	keywords: string[];
	fuzzy_threshold: number;
	comment_replies: string[];
	dm_message: string;
	dm_link: string | null;
	match_count: number;
	metadata: Json;
	created_at: string;
	updated_at: string;
};

export type AutomationMatchRow = {
	id: string;
	automation_id: string;
	message_id: string;
	contact_id: string;
	matched_keyword: string;
	match_type: string;
	fuzzy_distance: number | null;
	comment_reply_sent: boolean;
	dm_sent: boolean;
	dm_platform_message_id: string | null;
	created_at: string;
};

export type WebhookEventRow = {
	id: string;
	platform: Platform;
	event_type: string;
	payload: Json;
	created_at: string;
};
