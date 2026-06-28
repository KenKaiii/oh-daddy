import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Variant =
	| "primary"
	| "ink"
	| "outline"
	| "ghost"
	| "destructive"
	| "danger";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
	// Single solid-violet activation element per view — the main CTA.
	// Gradient fill; violet glow appears only on hover.
	primary:
		"bg-gradient-to-b from-[var(--primary-hover)] to-primary text-primary-foreground shadow-[0_10px_28px_-6px_transparent,inset_0_1px_0_0_rgba(255,255,255,0.18)] hover:shadow-[0_10px_28px_-6px_var(--primary),inset_0_1px_0_0_rgba(255,255,255,0.25)] hover:brightness-110",
	// Secondary action — Midnight Ink fill.
	ink: "bg-ink text-ink-foreground shadow-sm hover:bg-black hover:shadow-md",
	// Neutral secondary — translucent glass w/ hairline border.
	outline:
		"border border-border bg-white/[0.03] text-foreground backdrop-blur-sm hover:border-foreground/40 hover:bg-white/[0.07]",
	ghost: "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
	// Quiet destructive — text-only (Delete links on cards).
	destructive: "text-destructive hover:bg-destructive/10",
	// Solid destructive — confirmation CTAs. Red glow only on hover.
	danger:
		"bg-destructive text-destructive-foreground shadow-[0_10px_28px_-6px_transparent,inset_0_1px_0_0_rgba(255,255,255,0.18)] hover:shadow-[0_10px_28px_-6px_var(--destructive),inset_0_1px_0_0_rgba(255,255,255,0.25)] hover:brightness-110",
};

const sizes: Record<Size, string> = {
	sm: "h-8 px-3.5 text-[13px] gap-1.5",
	md: "h-10 px-5 text-sm gap-2",
	icon: "h-9 w-9",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	size?: Size;
}

export function Button({
	className,
	variant = "primary",
	size = "md",
	...props
}: ButtonProps) {
	return (
		<button
			className={cn(
				"ring-focus inline-flex cursor-pointer items-center justify-center rounded-full font-medium transition-[box-shadow,filter,background-color,border-color,color,transform] duration-300 ease-in-out active:scale-[0.97] active:duration-100 disabled:pointer-events-none disabled:opacity-50",
				variants[variant],
				sizes[size],
				className,
			)}
			{...props}
		/>
	);
}
