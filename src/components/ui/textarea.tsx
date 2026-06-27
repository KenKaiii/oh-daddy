import type { TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Textarea({
	className,
	...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return (
		<textarea
			className={cn(
				"ring-focus flex min-h-24 w-full rounded-md border border-input glass-field px-3.5 py-2.5 text-sm text-foreground transition-colors duration-200 placeholder:text-muted-foreground/45 hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
