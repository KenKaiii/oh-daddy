"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

export function CopyButton({
	value,
	className,
	label = "Copy",
}: {
	value: string;
	className?: string;
	label?: string;
}) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard unavailable (insecure context / denied) — no-op.
		}
	}

	return (
		<button
			type="button"
			onClick={copy}
			aria-label={copied ? "Copied" : label}
			className={cn(
				"inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground",
				copied && "border-success/50 text-success",
				className,
			)}
		>
			{copied ? "Copied" : label}
		</button>
	);
}
