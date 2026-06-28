/**
 * Permissions requested during the Meta connect flow. Single source of truth.
 *
 * Kept in its own module (no server-only imports) so both the server OAuth
 * builder (`./urls`) and the client setup wizard can import it without dragging
 * the `postgres`/`db` dependency tree into the browser bundle.
 */
export const META_SCOPES = [
	"business_management",
	"pages_manage_engagement",
	"pages_manage_metadata",
	"pages_read_user_content",
	"pages_show_list",
	"pages_messaging",
	"instagram_basic",
	"instagram_manage_comments",
	"instagram_manage_messages",
] as const;
