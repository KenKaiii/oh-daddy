"use client";

import { type ReactNode, useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Inline hyperlink helper — underlined accent, opens in a new tab. Used for the
 * "go do this in Meta" links peppered through the wizard copy.
 */
export function ExtLink({
	href,
	children,
	className,
}: {
	href: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className={cn(
				"ring-focus font-medium text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary",
				className,
			)}
		>
			{children}
		</a>
	);
}

/**
 * A single acknowledgement checkbox row with an animated check (ported from a
 * Uiverse component by MattiaCode-IT; styles live in globals.css under the
 * `.checkbox-*` classes, tuned for the dark theme).
 *
 * The label associates to the input via `htmlFor`, so per the HTML spec a click
 * on an interactive descendant (the inline links) navigates without toggling.
 */
export function CheckItem({
	checked,
	onChange,
	children,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
	children: ReactNode;
}) {
	const id = useId();
	return (
		<div className="checkbox-container">
			<input
				type="checkbox"
				id={id}
				className="task-checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<label htmlFor={id} className="checkbox-label">
				<span className="checkbox-box">
					<span className="checkbox-fill" />
					<span className="checkmark">
						<svg viewBox="0 0 24 24" className="check-icon" aria-hidden="true">
							<title>Confirmed</title>
							<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
						</svg>
					</span>
					<span className="success-ripple" />
				</span>
				<span className="checkbox-text">{children}</span>
			</label>
		</div>
	);
}

/**
 * Read-only value to paste into Meta: labelled input with a Copy button. For
 * every "copy this value over there" moment in the wizard.
 */
export function CopyField({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	hint?: ReactNode;
}) {
	return (
		<div className="space-y-1.5">
			<Label>{label}</Label>
			<div className="group relative">
				<Input
					readOnly
					value={value}
					placeholder="…"
					className="pr-20 font-mono text-xs"
				/>
				<CopyButton
					value={value}
					className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100"
				/>
			</div>
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}

/**
 * Value to bring back from Meta: labelled input + inline Save button and a
 * Set/Not-set badge. Calls `onSave` with the trimmed value; clears on success.
 */
export function PasteField({
	label,
	provider,
	placeholder,
	secret,
	isSet,
	onSave,
	hint,
	rightSlot,
}: {
	label: string;
	provider: string;
	placeholder?: string;
	secret?: boolean;
	isSet: boolean;
	onSave: (value: string) => Promise<void>;
	hint?: ReactNode;
	/** Optional extra control rendered next to the badge (e.g. Generate). */
	rightSlot?: ReactNode;
}) {
	const [value, setValue] = useState("");
	const [saving, setSaving] = useState(false);

	async function save() {
		const trimmed = value.trim();
		if (trimmed === "") return;
		setSaving(true);
		try {
			await onSave(trimmed);
			setValue("");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between gap-2">
				<span className="flex items-center gap-2">
					<Label htmlFor={`setup-${provider}`}>{label}</Label>
					{isSet ? (
						<Badge variant="positive">Set</Badge>
					) : (
						<Badge variant="muted">Not set</Badge>
					)}
				</span>
				{rightSlot}
			</div>
			<div className="flex items-center gap-2">
				<Input
					id={`setup-${provider}`}
					type={secret ? "password" : "text"}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") save();
					}}
					placeholder={
						isSet ? "•••••• (leave blank to keep)" : (placeholder ?? "")
					}
					autoComplete="off"
				/>
				<Button onClick={save} disabled={saving || value.trim() === ""}>
					{saving ? "Saving…" : "Save"}
				</Button>
			</div>
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}
