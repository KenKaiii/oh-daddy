import { MetaApiCallError, type MetaApiErrorBody } from "./meta-error";
import type {
	NormalizedContact,
	NormalizedMessage,
	PlatformAdapter,
	PlatformPost,
	PostCommentReplyParams,
	SendPrivateReplyParams,
} from "./types";

const GRAPH_API_BASE = "https://graph.facebook.com/v25.0";

/**
 * Graph node ids are numeric, optionally underscore-joined composites — e.g. a
 * comment id is `{pagepost-id}_{comment-id}` and a pagepost-id is itself
 * `{page-id}_{post-id}`, so a valid id may be multi-segment like `123_456_789`.
 * @see https://developers.facebook.com/docs/graph-api/reference/comment/
 */
const GRAPH_NODE_ID = /^\d+(_\d+)*$/;

/**
 * Defense-in-depth for URL construction: validate a Graph node id against the
 * strict numeric/underscore format, then return it encoded for safe use as a
 * URL path segment. Throws on anything else so a malformed id can never alter
 * the request path. The encode is a no-op for legitimate ids (digits and `_`
 * are URL-unreserved) but guards against future callers passing untrusted ids.
 */
export function graphNodeId(id: string): string {
	if (!GRAPH_NODE_ID.test(id)) {
		throw new MetaApiCallError(`Invalid Graph node id: ${id}`, {
			status: 400,
			body: null,
		});
	}
	return encodeURIComponent(id);
}

interface FBCommentData {
	id?: string;
	comment_id?: string;
	message?: string;
	from?: { id: string; name?: string };
	post_id?: string;
	parent_id?: string;
	created_time?: string | number;
	verb?: string;
}

/** Convert created_time (Unix seconds, Unix ms, or ISO string) to ISO string. */
function normalizeTimestamp(t?: string | number): string {
	if (!t) return new Date().toISOString();
	if (typeof t === "number") {
		const ms = t < 1e12 ? t * 1000 : t;
		return new Date(ms).toISOString();
	}
	const d = new Date(t);
	return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

interface FBPostData {
	id: string;
	message?: string;
	full_picture?: string;
	permalink_url?: string;
	created_time?: string;
}

interface MetaApiErrorResponse {
	error?: MetaApiErrorBody;
}

export async function metaApiFetch<T>(
	url: string,
	options?: RequestInit,
): Promise<T> {
	const response = await fetch(url, options);
	if (!response.ok) {
		let body: MetaApiErrorResponse | null = null;
		try {
			body = (await response.json()) as MetaApiErrorResponse;
		} catch {
			body = null;
		}
		const msg =
			body?.error?.message ?? `Facebook API error: ${response.status}`;
		throw new MetaApiCallError(msg, {
			status: response.status,
			body: body?.error ?? null,
		});
	}
	return response.json() as Promise<T>;
}

/**
 * Fetch comment author info from the Graph API. The webhook payload often
 * omits `from`, so we fetch it individually when author info is missing.
 * Returns null if the API doesn't return author info (e.g. deleted user).
 */
export async function fetchCommentAuthor(
	accessToken: string,
	commentId: string,
): Promise<{ id: string; name: string | null } | null> {
	try {
		const url = `${GRAPH_API_BASE}/${graphNodeId(commentId)}?fields=from`;
		const data = await metaApiFetch<{ from?: { id: string; name?: string } }>(
			url,
			{ headers: { Authorization: `Bearer ${accessToken}` } },
		);
		if (!data.from?.id) return null;
		return { id: data.from.id, name: data.from.name ?? null };
	} catch {
		return null;
	}
}

export const facebookAdapter: PlatformAdapter = {
	platform: "facebook",

	normalizeComment(raw: unknown): NormalizedMessage {
		const data = raw as FBCommentData;
		const commentId = data.comment_id ?? data.id ?? "";

		// For top-level comments Facebook sets parent_id to the post_id. We must
		// use the comment's own id as the thread id so replies go UNDER the
		// user's comment instead of creating a new top-level comment.
		const isTopLevel = !data.parent_id || data.parent_id === data.post_id;
		const threadId = isTopLevel ? commentId : (data.parent_id as string);

		return {
			platformMessageId: commentId,
			platformThreadId: threadId,
			platformPostId: data.post_id ?? null,
			platformUserId: data.from?.id ?? "",
			userName: data.from?.name ?? null,
			userUsername: null,
			userAvatarUrl: null,
			content: data.message ?? "",
			timestamp: normalizeTimestamp(data.created_time),
			interactionType: "comment",
			metadata: { raw },
		};
	},

	normalizeContact(raw: unknown): NormalizedContact {
		const data = raw as FBCommentData;
		return {
			platformUserId: data.from?.id ?? "",
			name: data.from?.name ?? null,
			username: null,
			avatarUrl: null,
			metadata: { raw },
		};
	},

	async postCommentReply(params: PostCommentReplyParams): Promise<string> {
		const url = `${GRAPH_API_BASE}/${graphNodeId(params.parentCommentId)}/comments`;
		const result = await metaApiFetch<{ id: string }>(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${params.accessToken}`,
			},
			body: JSON.stringify({ message: params.content }),
		});
		return result.id;
	},

	async sendPrivateReply(params: SendPrivateReplyParams): Promise<string> {
		// Private Reply: POST /PAGE-ID/messages with recipient.comment_id.
		// Bypasses the 24h messaging window. One reply per comment, within 7 days.
		const url = `${GRAPH_API_BASE}/${graphNodeId(params.accountId)}/messages`;
		const result = await metaApiFetch<{ message_id: string }>(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${params.accessToken}`,
			},
			body: JSON.stringify({
				recipient: { comment_id: params.commentId },
				message: { text: params.content },
			}),
		});
		return result.message_id;
	},

	async listPosts(
		accessToken: string,
		accountId: string,
	): Promise<PlatformPost[]> {
		const fields = "id,message,full_picture,permalink_url,created_time";
		const url = `${GRAPH_API_BASE}/${graphNodeId(accountId)}/posts?fields=${fields}&limit=50`;
		const result = await metaApiFetch<{ data?: FBPostData[] }>(url, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		return (result.data ?? []).map((p) => ({
			id: p.id,
			caption: p.message ?? "",
			thumbnailUrl: p.full_picture ?? null,
			permalink: p.permalink_url ?? null,
			timestamp: p.created_time ? normalizeTimestamp(p.created_time) : null,
		}));
	},
};
