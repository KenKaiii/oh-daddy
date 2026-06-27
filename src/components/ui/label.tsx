import type { LabelHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Label({
	className,
	...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: generic primitive; callers pass htmlFor
		<label
			className={cn(
				"text-[13px] font-medium leading-none text-foreground",
				className,
			)}
			{...props}
		/>
	);
}
