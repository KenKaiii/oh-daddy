"use client";

import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

/**
 * App toaster — bottom-right, dark glass styling to match the theme.
 * Semantic icon colors keep success/error/etc. instantly readable while the
 * surface stays on-brand (translucent card + blur).
 */
export function Toaster() {
	return (
		<Sonner
			position="bottom-right"
			theme="dark"
			gap={10}
			offset={18}
			visibleToasts={4}
			closeButton
			style={
				{
					"--normal-bg": "color-mix(in oklab, var(--card) 72%, transparent)",
					"--normal-text": "var(--foreground)",
					"--normal-border": "var(--border)",
				} as CSSProperties
			}
			toastOptions={{
				classNames: {
					toast:
						"!rounded-xl !backdrop-blur-xl !font-sans !text-[13px] !shadow-[0_18px_44px_-20px_rgba(0,0,0,0.75)]",
					title: "!font-medium !text-foreground",
					description: "!text-muted-foreground",
					closeButton:
						"!bg-card !border-border !text-muted-foreground hover:!text-foreground",
					success: "[&_[data-icon]]:!text-emerald-400",
					error: "[&_[data-icon]]:!text-destructive",
					warning: "[&_[data-icon]]:!text-amber-400",
					info: "[&_[data-icon]]:!text-primary",
				},
			}}
		/>
	);
}
