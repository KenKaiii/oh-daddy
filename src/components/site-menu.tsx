"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import StaggeredMenu, {
	type StaggeredMenuItem,
} from "@/components/StaggeredMenu";
import { apiFetch } from "@/lib/api-client";

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
			footerNode={
				setupIncomplete === false
					? (close) => (
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
						)
					: undefined
			}
			displaySocials={false}
			displayItemNumbering={false}
			isFixed
			menuButtonColor="#f4f4f6"
			openMenuButtonColor="#0a0a0f"
			changeMenuColorOnOpen
			colors={["#211f3d", "#6d6dfb"]}
			accentColor="#6d6dfb"
			logoNode={
				<Link
					href="/"
					aria-label="Oh Daddy — home"
					className="brand-shimmer font-display text-xl font-bold tracking-tight"
				>
					Oh Daddy
				</Link>
			}
		/>
	);
}
