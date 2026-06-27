"use client";

import { cn } from "@/lib/utils";

export interface SwitchProps {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
	"aria-label"?: string;
}

export function Switch({
	checked,
	onCheckedChange,
	disabled,
	...props
}: SwitchProps) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			onClick={() => onCheckedChange(!checked)}
			style={{
				background: checked
					? "linear-gradient(to bottom, #4cd964, #5de24e)"
					: "linear-gradient(to bottom, #b3b3b3, #e6e6e6)",
			}}
			className={cn(
				"ring-focus relative h-[25px] w-[50px] shrink-0 cursor-pointer rounded-full transition-all duration-300 ease-in-out disabled:cursor-not-allowed disabled:opacity-50",
			)}
			{...props}
		>
			<span
				className={cn(
					"absolute top-px left-px h-[23px] w-[23px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-300 ease-in-out",
					checked ? "translate-x-[25px]" : "translate-x-0",
				)}
			/>
		</button>
	);
}
