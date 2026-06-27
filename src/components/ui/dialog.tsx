"use client";

import { useEffect } from "react";

import { cn } from "@/lib/utils";

export interface DialogProps {
	open: boolean;
	onClose: () => void;
	children: React.ReactNode;
	className?: string;
}

export function Dialog({ open, onClose, children, className }: DialogProps) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = "";
		};
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 overflow-y-auto bg-black/55 backdrop-blur-md">
			{/* min-h-full + items-center keeps the panel vertically centered, but
			    lets it scroll from the top when it's taller than the viewport.
			    Clicking this backdrop area (outside the panel) closes the dialog. */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-close; Escape key handled globally above */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape close is wired via the keydown effect */}
			<div
				className="flex min-h-full items-center justify-center p-4 sm:p-8"
				onClick={onClose}
			>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: stops backdrop close when interacting inside the panel */}
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: panel is not a click target, only stops propagation */}
				<div
					className={cn(
						"glass relative z-10 w-full max-w-lg rounded-2xl p-6",
						className,
					)}
					onClick={(e) => e.stopPropagation()}
				>
					{children}
				</div>
			</div>
		</div>
	);
}

export function DialogHeader({
	title,
	description,
}: {
	title: string;
	description?: string;
}) {
	return (
		<div className="mb-5 flex flex-col gap-1.5">
			<h2 className="font-display text-xl font-semibold">{title}</h2>
			{description && (
				<p className="text-sm text-muted-foreground">{description}</p>
			)}
		</div>
	);
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
	return (
		<div className="mt-6 flex items-center justify-end gap-2">{children}</div>
	);
}
