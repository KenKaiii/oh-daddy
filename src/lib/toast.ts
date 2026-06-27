import { toast } from "sonner";

import { formatError } from "@/lib/utils";

/**
 * Centralized toast helpers. Every error passes through `formatError` so a
 * raw JSON blob or Error object never reaches the user — only a clean,
 * readable message.
 */
export const notify = {
	success: (message: string) => toast.success(message),
	error: (err: unknown) => toast.error(formatError(err)),
	info: (message: string) => toast.info(message),
	message: (message: string) => toast(message),
};
