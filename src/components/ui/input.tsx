import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Input({
	className,
	...props
}: InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			className={cn(
				"ring-focus flex h-10 w-full rounded-md border border-input glass-field px-3.5 text-sm text-foreground transition-colors duration-200 placeholder:text-muted-foreground/45 hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
