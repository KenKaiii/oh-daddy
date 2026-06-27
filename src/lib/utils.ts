import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** Format an unknown error into a user-displayable string. */
export function formatError(error: unknown): string {
	if (typeof error === "string") return error;
	if (error instanceof Error) return error.message;
	return String(error);
}
