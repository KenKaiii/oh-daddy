import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "positive" | "muted" | "outline";

const variants: Record<Variant, string> = {
	// Data token (keyword chips) — neutral, mono for a technical feel.
	default: "bg-muted text-foreground/80 font-mono",
	// Affirmative / active — violet-tint (single accent, lower prominence
	// than the solid-violet primary CTA).
	success: "bg-accent text-accent-foreground",
	// Affirmative status (“Set” / “Done”) — solid bright green with white text.
	positive: "bg-emerald-500 text-white",
	muted: "bg-muted text-muted-foreground",
	// Neutral metadata chip — borderless subtle fill (no badge carries a border).
	outline: "bg-foreground/5 text-muted-foreground",
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
