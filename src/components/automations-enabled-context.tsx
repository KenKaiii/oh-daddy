"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";

import { apiFetch } from "@/lib/api-client";
import { notify } from "@/lib/toast";

/**
 * Shared client state for the global emergency-stop switch, so the nav's
 * toggle (`SystemToggle` in `site-menu.tsx`) and any page that needs to
 * reflect it (e.g. the Automations list, so individual cards don't look
 * "active" while everything is globally paused) read and flip the exact same
 * value — no separate fetches that can drift out of sync.
 */
interface AutomationsEnabledContextValue {
	/** `null` until the initial fetch resolves. */
	enabled: boolean | null;
	toggling: boolean;
	toggle: () => Promise<void>;
}

const AutomationsEnabledContext = createContext<AutomationsEnabledContextValue>(
	{
		enabled: null,
		toggling: false,
		toggle: async () => {},
	},
);

export function useAutomationsEnabled(): AutomationsEnabledContextValue {
	return useContext(AutomationsEnabledContext);
}

export function AutomationsEnabledProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [enabled, setEnabled] = useState<boolean | null>(null);
	const [toggling, setToggling] = useState(false);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await apiFetch("/api/settings/automations-enabled");
				if (!res.ok) return;
				const json = await res.json();
				if (!cancelled) setEnabled(json.data?.enabled ?? true);
			} catch {
				// Non-fatal — leave callers in the "loading" state.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const toggle = useCallback(async () => {
		if (enabled === null || toggling) return;
		const next = !enabled;
		setEnabled(next);
		setToggling(true);
		try {
			const res = await apiFetch("/api/settings/automations-enabled", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: next }),
			});
			if (!res.ok) {
				const json = await res.json().catch(() => ({}));
				throw new Error(json.error ?? "Failed to update");
			}
			notify.success(
				next
					? "Automations back on"
					: "Automations paused — nothing will send until switched back on",
			);
		} catch (e) {
			// Revert the optimistic toggle.
			setEnabled(!next);
			notify.error(e);
		} finally {
			setToggling(false);
		}
	}, [enabled, toggling]);

	return (
		<AutomationsEnabledContext.Provider value={{ enabled, toggling, toggle }}>
			{children}
		</AutomationsEnabledContext.Provider>
	);
}
