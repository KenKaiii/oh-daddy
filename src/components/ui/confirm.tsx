"use client";

import {
	createContext,
	useCallback,
	useContext,
	useRef,
	useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";

export interface ConfirmOptions {
	title: string;
	description?: string;
	confirmText?: string;
	cancelText?: string;
	/** Styles the confirm button as a destructive (red) action. */
	destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

/** Hook: `const confirm = useConfirm(); if (await confirm({...})) {...}` */
export function useConfirm(): ConfirmFn {
	return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
	const [options, setOptions] = useState<ConfirmOptions | null>(null);
	const resolverRef = useRef<((value: boolean) => void) | null>(null);

	const confirm = useCallback<ConfirmFn>((opts) => {
		return new Promise<boolean>((resolve) => {
			resolverRef.current = resolve;
			setOptions(opts);
		});
	}, []);

	const settle = useCallback((value: boolean) => {
		resolverRef.current?.(value);
		resolverRef.current = null;
		setOptions(null);
	}, []);

	return (
		<ConfirmContext.Provider value={confirm}>
			{children}
			<Dialog
				open={options !== null}
				onClose={() => settle(false)}
				className="max-w-sm"
			>
				{options && (
					<>
						<DialogHeader
							title={options.title}
							description={options.description}
						/>
						<DialogFooter>
							<Button variant="outline" onClick={() => settle(false)}>
								{options.cancelText ?? "Cancel"}
							</Button>
							<Button
								variant={options.destructive ? "danger" : "primary"}
								onClick={() => settle(true)}
							>
								{options.confirmText ?? "Confirm"}
							</Button>
						</DialogFooter>
					</>
				)}
			</Dialog>
		</ConfirmContext.Provider>
	);
}
