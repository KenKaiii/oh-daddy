import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { cookies } from "next/headers";

import { AutomationsEnabledProvider } from "@/components/automations-enabled-context";
import { ClickSound } from "@/components/click-sound";
import SideRays from "@/components/SideRays";
import { SiteMenu } from "@/components/site-menu";
import { ConfirmProvider } from "@/components/ui/confirm";
import { Toaster } from "@/components/ui/toaster";
import { isAuthorized, SESSION_COOKIE } from "@/lib/auth";

import "./globals.css";

// Titles — Redaction grade 50 (bold). Body uses Datatype (loaded via
// @import in globals.css; not in Next's bundled Google font list).
const redactionDisplay = localFont({
	src: "../fonts/Redaction50Bold.woff2",
	variable: "--font-redaction-display",
	weight: "700",
	display: "swap",
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const DESCRIPTION =
	"Drop a keyword, get a reply. Oh Daddy auto-replies to comments and slides into DMs on Instagram and Facebook. Set it once, let it cook.";

export const metadata: Metadata = {
	metadataBase: new URL(APP_URL),
	title: {
		default: "Oh Daddy. Comment automations on autopilot",
		template: "%s · Oh Daddy",
	},
	description: DESCRIPTION,
	applicationName: "Oh Daddy",
	keywords: [
		"comment automation",
		"Instagram DM automation",
		"Facebook comment reply",
		"keyword DM",
		"auto reply",
		"ManyChat alternative",
	],
	authors: [{ name: "Oh Daddy" }],
	openGraph: {
		type: "website",
		siteName: "Oh Daddy",
		url: APP_URL,
		title: "Oh Daddy. Comment automations on autopilot",
		description: DESCRIPTION,
	},
	twitter: {
		card: "summary_large_image",
		title: "Oh Daddy. Comment automations on autopilot",
		description: DESCRIPTION,
	},
	robots: { index: true, follow: true },
};

export default async function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	// The nav is only rendered for the authenticated operator. Auth is proven by
	// the httpOnly session cookie (unreadable from client JS), so this decision
	// must be made server-side here — no flash of nav for logged-out visitors.
	const cookieStore = await cookies();
	const authed = isAuthorized(null, cookieStore.get(SESSION_COOKIE)?.value);

	return (
		<html
			lang="en"
			className={`${redactionDisplay.variable} ${geistMono.variable} h-full antialiased`}
		>
			<head>
				{/* Datatype (Google Fonts) — body typeface. Loaded via link because
				    it isn't in Next's bundled next/font/google list yet. */}
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link
					rel="preconnect"
					href="https://fonts.gstatic.com"
					crossOrigin="anonymous"
				/>
				<link
					href="https://fonts.googleapis.com/css2?family=Datatype:wght@100..900&display=swap"
					rel="stylesheet"
				/>
			</head>
			{/* suppressHydrationWarning: browser extensions (e.g. ColdTurkey,
			    Grammarly) inject attributes like cz-shortcut-listen onto <body>
			    before React hydrates, which is harmless but trips the warning. */}
			<body className="min-h-full" suppressHydrationWarning>
				<ClickSound />
				<div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
					<SideRays
						speed={2.5}
						rayColor1="#EAB308"
						rayColor2="#96c8ff"
						intensity={2}
						spread={2}
						origin="top-right"
						tilt={0}
						saturation={1.5}
						blend={0.75}
						falloff={1.6}
						opacity={1}
					/>
				</div>
				<ConfirmProvider>
					{authed ? (
						<AutomationsEnabledProvider>
							<SiteMenu />
							<main className="mx-auto max-w-5xl px-4 pb-16 pt-24 sm:px-6">
								{children}
							</main>
						</AutomationsEnabledProvider>
					) : (
						<main className="mx-auto w-full max-w-5xl px-4 sm:px-6">
							{children}
						</main>
					)}
				</ConfirmProvider>
				<Toaster />
			</body>
		</html>
	);
}
