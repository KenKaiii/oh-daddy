import { z } from "zod";

/** Meta-only platform types for the MVP. */
export const platformTypeSchema = z.enum(["facebook", "instagram"]);
export type PlatformType = z.infer<typeof platformTypeSchema>;

export const interactionTypeSchema = z.enum(["comment", "dm"]);
export type InteractionType = z.infer<typeof interactionTypeSchema>;

export const messageRoleSchema = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;
