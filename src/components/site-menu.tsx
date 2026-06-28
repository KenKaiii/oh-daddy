"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import StaggeredMenu, {
	type StaggeredMenuItem,
} from "@/components/StaggeredMenu";

const menuItems: StaggeredMenuItem[] = [
	{ label: "Setup", ariaLabel: "Open the guided setup", link: "/setup" },
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

export function SiteMenu() {
	const router = useRouter();
	return (
		<StaggeredMenu
			position="right"
			items={menuItems}
			// Client-side navigation so there's no full-page reload flash. The
			// menu's close animation then plays smoothly over the new page.
			onItemClick={(link, e) => {
				e.preventDefault();
				router.push(link);
			}}
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
