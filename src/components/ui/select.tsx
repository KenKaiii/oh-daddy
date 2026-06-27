import type { SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

// Custom chevron (own SVG) so we control its inset — the native arrow sits
// flush against the right edge. appearance-none hides the native one.
const CHEVRON =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239a9aa6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E";

export function Select({
	className,
	children,
	...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<select
			style={{
				backgroundImage: `url("${CHEVRON}")`,
				backgroundRepeat: "no-repeat",
				backgroundPosition: "right 0.875rem center",
			}}
			className={cn(
				"ring-focus flex h-10 w-full cursor-pointer appearance-none rounded-md border border-input glass-field pl-3.5 pr-10 text-sm text-foreground transition-colors duration-200 hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		>
			{children}
		</select>
	);
}
