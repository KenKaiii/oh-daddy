import type { PlatformType } from "@/lib/schemas/platform";

import { facebookAdapter } from "./facebook";
import { instagramAdapter } from "./instagram";
import type { PlatformAdapter } from "./types";

const adapters: Record<PlatformType, PlatformAdapter> = {
	facebook: facebookAdapter,
	instagram: instagramAdapter,
};

export function getAdapter(platform: PlatformType): PlatformAdapter {
	const adapter = adapters[platform];
	if (!adapter) {
		throw new Error(`No adapter for platform: ${platform}`);
	}
	return adapter;
}

export type {
	NormalizedContact,
	NormalizedMessage,
	PlatformAdapter,
	PostCommentReplyParams,
	SendPrivateReplyParams,
} from "./types";
