"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import StaggeredMenu, {
	type StaggeredMenuItem,
} from "@/components/StaggeredMenu";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-client";
import { notify } from "@/lib/toast";

const baseItems: StaggeredMenuItem[] = [
	{ label: "Dashboard", ariaLabel: "Go to the dashboard", link: "/" },
	{
		label: "Automations",
		ariaLabel: "Manage keyword automations",
		link: "/automations",
	},
	{
		label: "Accounts",
		ariaLabel: "Manage connected accounts",
		link: "/accounts",
	},
	{ label: "Settings", ariaLabel: "Open settings", link: "/settings" },
];

const setupItem: StaggeredMenuItem = {
	label: "Setup",
	ariaLabel: "Open the guided setup",
	link: "/setup",
};

async function logout() {
	try {
		await fetch("/api/auth/login", { method: "DELETE" });
	} finally {
		// Full reload so every in-memory/session-derived state resets cleanly.
		window.location.href = "/login";
	}
}

/**
 * Global emergency stop for every keyword automation at once, regardless of
 * each automation's own is_active flag. Sits next to the logo so it's always
 * one click away from any page.
 */
function SystemToggle() {
	const [enabled, setEnabled] = useState<boolean | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await apiFetch("/api/settings/automations-enabled");
				if (!res.ok) return;
				const json = await res.json();
				if (!cancelled) setEnabled(json.data?.enabled ?? true);
			} catch {
				// Non-fatal — leave the toggle hidden if status can't load.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	async function toggle() {
		if (enabled === null || busy) return;
		const next = !enabled;
		setEnabled(next);
		setBusy(true);
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
			setBusy(false);
		}
	}

	// Stay hidden until the initial state resolves so it never flashes the
	// wrong color.
	if (enabled === null) return null;

	return (
		<div className="flex items-center gap-2">
			<Badge variant={enabled ? "positive" : "danger"}>
				System {enabled ? "on" : "off"}
			</Badge>
			<Switch
				checked={enabled}
				onCheckedChange={toggle}
				disabled={busy}
				aria-label="Emergency stop: turn all automations on or off"
			/>
		</div>
	);
}

export function SiteMenu() {
	const router = useRouter();
	// `null` until the status check resolves, so we don't flash the Setup item
	// for an already-configured operator (or hide it for one who needs it).
	const [setupIncomplete, setSetupIncomplete] = useState<boolean | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const [settingsRes, accountsRes] = await Promise.all([
					apiFetch("/api/settings"),
					apiFetch("/api/accounts"),
				]);
				if (!settingsRes.ok || !accountsRes.ok) return;
				const settingsJson = await settingsRes.json();
				const accountsJson = await accountsRes.json().catch(() => ({}));
				const rows: { is_set: boolean }[] = settingsJson.data ?? [];
				const accounts: { is_connected: boolean }[] = accountsJson.data ?? [];
				const credsMissing = rows.length === 0 || rows.some((r) => !r.is_set);
				const noAccounts = accounts.filter((a) => a.is_connected).length === 0;
				if (!cancelled) setSetupIncomplete(credsMissing || noAccounts);
			} catch {
				// Non-fatal — leave the Setup item hidden if status can't load.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// Show the prominent "Setup" nav item only while setup is unfinished. Once
	// done, it moves to a quiet "Run setup again" footer link.
	const items =
		setupIncomplete === true ? [setupItem, ...baseItems] : baseItems;

	return (
		<StaggeredMenu
			position="right"
			items={items}
			// Client-side navigation so there's no full-page reload flash. The
			// menu's close animation then plays smoothly over the new page.
			onItemClick={(link, e) => {
				e.preventDefault();
				router.push(link);
			}}
			footerNode={(close) => (
				<div className="flex flex-col items-start gap-3">
					{setupIncomplete === false && (
						<button
							type="button"
							onClick={() => {
								close();
								router.push("/setup");
							}}
							className="text-sm font-medium text-black/55 underline decoration-black/25 underline-offset-4 transition-colors hover:text-black hover:decoration-black"
						>
							Run setup again
						</button>
					)}
					<button
						type="button"
						onClick={() => {
							close();
							logout();
						}}
						className="text-sm font-medium text-black/55 underline decoration-black/25 underline-offset-4 transition-colors hover:text-black hover:decoration-black"
					>
						Log out
					</button>
				</div>
			)}
			displaySocials={false}
			displayItemNumbering={false}
			isFixed
			menuButtonColor="#f4f4f6"
			openMenuButtonColor="#0a0a0f"
			changeMenuColorOnOpen
			colors={["#211f3d", "#6d6dfb"]}
			accentColor="#6d6dfb"
			logoNode={
				<div className="flex items-center gap-3">
					<Link
						href="/"
						aria-label="Oh Daddy — home"
						className="brand-shimmer font-display text-xl font-bold tracking-tight"
					>
						Oh Daddy
					</Link>
					<SystemToggle />
				</div>
			}
		/>
	);
}
