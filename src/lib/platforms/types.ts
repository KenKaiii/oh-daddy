import type { PlatformType } from "@/lib/schemas/platform";

/** What we normalize every comment into, regardless of platform. */
export interface NormalizedMessage {
	platformMessageId: string;
	platformThreadId: string;
	platformPostId: string | null;
	platformUserId: string;
	userName: string | null;
	userUsername: string | null;
	userAvatarUrl: string | null;
	content: string;
	timestamp: string;
	interactionType: "comment" | "dm";
	metadata: Record<string, unknown>;
}

/** Normalized contact info extracted from platform data. */
export interface NormalizedContact {
	platformUserId: string;
	name: string | null;
	username: string | null;
	avatarUrl: string | null;
	metadata: Record<string, unknown>;
}

/** Params for posting a public comment reply. */
export interface PostCommentReplyParams {
	accessToken: string;
	parentCommentId: string;
	content: string;
	accountId?: string;
}

/**
 * Params for sending a Private Reply — a single DM a Page sends in direct
 * response to a public comment. Bypasses the standard 24-hour messaging
 * window because Meta treats it as a continuation of the commenter's public
 * engagement. Must be sent within 7 days of the comment, and only ONE
 * private reply is allowed per comment.
 *
 * @see https://developers.facebook.com/docs/messenger-platform/discovery/private-replies/
 */
export interface SendPrivateReplyParams {
	accessToken: string;
	/** Platform-side comment id we're replying to. */
	commentId: string;
	content: string;
	/** Page id (Facebook) or IG Business Account id. */
	accountId: string;
}

/**
 * A single published post/media item on a connected account, trimmed to what a
 * post-targeting picker needs. Most-recent-first; one page only (no paging).
 */
export interface PlatformPost {
	/** Platform-side post/media id (matches NormalizedMessage.platformPostId). */
	id: string;
	/** Caption / message text, may be empty. */
	caption: string;
	/** A thumbnail/preview image url when available. */
	thumbnailUrl: string | null;
	/** Public permalink to the post. */
	permalink: string | null;
	/** ISO timestamp the post was published. */
	timestamp: string | null;
}

/** The trimmed adapter interface every Meta platform implements. */
export interface PlatformAdapter {
	platform: PlatformType;

	normalizeComment(raw: unknown): NormalizedMessage;
	normalizeContact(raw: unknown): NormalizedContact;

	postCommentReply(params: PostCommentReplyParams): Promise<string>;
	sendPrivateReply(params: SendPrivateReplyParams): Promise<string>;

	/**
	 * List recent posts on the account. `accountId` is the platform-side id
	 * (Page id / IG user id). Returns the first page, most recent first.
	 */
	listPosts(accessToken: string, accountId: string): Promise<PlatformPost[]>;
}
