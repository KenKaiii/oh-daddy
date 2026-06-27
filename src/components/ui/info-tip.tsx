"use client";

import { cn } from "@/lib/utils";

/**
 * Small "(i)" info affordance. Shows `text` on hover/focus as a tooltip.
 * CSS-only reveal (group-hover + focus-within) so there's no JS state.
 */
export function InfoTip({
	text,
	className,
}: {
	text: string;
	className?: string;
}) {
	return (
		<span className={cn("group relative inline-flex", className)}>
			<button
				type="button"
				aria-label={text}
				className="ring-focus flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-border text-[10px] font-semibold leading-none text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
			>
				i
			</button>
			<span
				role="tooltip"
				className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg border border-border bg-foreground px-3 py-2 text-xs leading-relaxed text-background opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
			>
				{text}
				<span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-foreground" />
			</span>
		</span>
	);
}
