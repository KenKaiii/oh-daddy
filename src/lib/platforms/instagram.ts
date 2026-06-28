import { graphNodeId, metaApiFetch } from "./facebook";
import type {
	NormalizedContact,
	NormalizedMessage,
	PlatformAdapter,
	PostCommentReplyParams,
	SendPrivateReplyParams,
} from "./types";

// All IG calls go through graph.instagram.com because tokens are issued via the
// Instagram Business Login flow (stored as IG-User tokens). graph.instagram.com
// rejects FB Page tokens with code 190 and vice-versa — Instagram accounts are
// connected exclusively through Instagram login now.
const IG_GRAPH_API_BASE = "https://graph.instagram.com/v23.0";

interface IGCommentData {
	id: string;
	text?: string;
	from?: { id: string; username?: string };
	media?: { id: string };
	timestamp?: string;
	parent_id?: string;
}

export const instagramAdapter: PlatformAdapter = {
	platform: "instagram",

	normalizeComment(raw: unknown): NormalizedMessage {
		const data = raw as IGCommentData;
		return {
			platformMessageId: data.id,
			platformThreadId: data.parent_id ?? data.id,
			platformPostId: data.media?.id ?? null,
			platformUserId: data.from?.id ?? "",
			userName: null,
			userUsername: data.from?.username ?? null,
			userAvatarUrl: null,
			content: data.text ?? "",
			timestamp: data.timestamp ?? new Date().toISOString(),
			interactionType: "comment",
			metadata: { raw },
		};
	},

	normalizeContact(raw: unknown): NormalizedContact {
		const data = raw as IGCommentData;
		return {
			platformUserId: data.from?.id ?? "",
			name: null,
			username: data.from?.username ?? null,
			avatarUrl: null,
			metadata: { raw },
		};
	},

	async postCommentReply(params: PostCommentReplyParams): Promise<string> {
		const url = `${IG_GRAPH_API_BASE}/${graphNodeId(params.parentCommentId)}/replies`;
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
		// Private Reply via recipient.comment_id. With an IG-User token the message
		// node is the IG account itself (POST /{IG_ID}/messages on
		// graph.instagram.com) — there is no Facebook Page in this flow.
		const url = `${IG_GRAPH_API_BASE}/${graphNodeId(params.accountId)}/messages`;
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
};
