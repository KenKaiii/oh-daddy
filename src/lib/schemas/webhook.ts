import { z } from "zod";

// ============================================================
// Meta (Instagram + Facebook) webhook payload
// ============================================================

export const metaWebhookEntrySchema = z.object({
	id: z.string(),
	time: z.number().optional(),
	messaging: z.array(z.record(z.string(), z.unknown())).optional(),
	changes: z
		.array(
			z.object({
				field: z.string(),
				value: z.record(z.string(), z.unknown()),
			}),
		)
		.optional(),
});
export type MetaWebhookEntry = z.infer<typeof metaWebhookEntrySchema>;

export const metaWebhookPayloadSchema = z.object({
	object: z.enum(["instagram", "page"]),
	entry: z.array(metaWebhookEntrySchema),
});
export type MetaWebhookPayload = z.infer<typeof metaWebhookPayloadSchema>;
