import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "positive" | "muted" | "outline";

const variants: Record<Variant, string> = {
	// Data token (keyword chips) — neutral, mono for a technical feel.
	default: "bg-muted text-foreground/80 font-mono",
	// Affirmative / active — violet-tint (single accent, lower prominence
	// than the solid-violet primary CTA).
	success: "bg-accent text-accent-foreground",
	// Configured/“Set” — soft green that reads affirmative against the dark
	// violet theme without competing with the primary CTA.
	positive: "bg-emerald-500/15 text-emerald-400",
	muted: "bg-muted text-muted-foreground",
	outline: "border border-border text-muted-foreground",
};

export function Badge({
	className,
	variant = "default",
	...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-5",
				variants[variant],
				className,
			)}
			{...props}
		/>
	);
}
