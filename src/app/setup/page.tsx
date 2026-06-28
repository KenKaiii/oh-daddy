"use client";

import { useRouter } from "next/navigation";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import {
	appBasicSettingsUrl,
	appLoginConfigurationsUrl,
	appLoginSettingsUrl,
	appWebhooksUrl,
	EXTERNAL_LINKS,
	PERMISSION_LIST,
	PERMISSION_LIST_TEXT,
	SETUP_STEPS,
	type SetupStepId,
} from "@/lib/setup-steps";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { useOAuthPopup } from "../accounts/_hooks/use-oauth-popup";
import {
	CheckItem,
	CopyField,
	ExtLink,
	PasteField,
} from "./_components/fields";

interface StatusRow {
	provider: string;
	is_set: boolean;
}

// Prerequisites the operator must confirm (checkbox each) before continuing.
const PREREQUISITES: { key: string; label: ReactNode }[] = [
	{
		key: "fb-account",
		label: (
			<>
				A{" "}
				<ExtLink href={EXTERNAL_LINKS.facebookSignup}>Facebook account</ExtLink>
				.
			</>
		),
	},
	{
		key: "fb-page",
		label: (
			<>
				A <ExtLink href={EXTERNAL_LINKS.createPage}>Facebook Page</ExtLink> you
				manage.
			</>
		),
	},
	{
		key: "ig-business",
		label: (
			<>
				For Instagram: an{" "}
				<ExtLink href={EXTERNAL_LINKS.instagramBusiness}>
					Instagram Business or Creator account
				</ExtLink>{" "}
				linked to that Page.
			</>
		),
	},
	{
		key: "business-portfolio",
		label: (
			<>
				A{" "}
				<ExtLink href={EXTERNAL_LINKS.businessPortfolio}>
					Meta Business portfolio
				</ExtLink>
				.
			</>
		),
	},
];

const TOTAL = SETUP_STEPS.length;
const SELF_KEY = (id: SetupStepId) => `setup:step:${id}`;
const APP_ID_KEY = "setup:appId";

/** Generate a URL-safe random verify token (48 hex chars / 24 bytes). */
function randomVerifyToken(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function SetupPage() {
	const router = useRouter();
	const [status, setStatus] = useState<StatusRow[]>([]);
	const [connectedCount, setConnectedCount] = useState(0);
	const [selfDone, setSelfDone] = useState<Record<string, boolean>>({});
	// Which single step is on screen. `null` until the initial status loads so we
	// can land the operator on the first incomplete step.
	const [current, setCurrent] = useState<number | null>(null);
	const [appUrl, setAppUrl] = useState("");
	const [appId, setAppId] = useState("");
	const [connecting, setConnecting] = useState(false);
	const [loading, setLoading] = useState(true);
	// Per-item acknowledgement for the prerequisites step (gates its Next button).
	const [prereqChecked, setPrereqChecked] = useState<Record<string, boolean>>(
		{},
	);

	const load = useCallback(async () => {
		try {
			const [settingsRes, accountsRes] = await Promise.all([
				apiFetch("/api/settings"),
				apiFetch("/api/accounts"),
			]);
			const settingsJson = await settingsRes.json();
			if (!settingsRes.ok)
				throw new Error(settingsJson.error ?? "Failed to load settings");
			setStatus(settingsJson.data ?? []);

			const accountsJson = await accountsRes.json();
			if (!accountsRes.ok)
				throw new Error(accountsJson.error ?? "Failed to load accounts");
			const accounts: { is_connected: boolean }[] = accountsJson.data ?? [];
			setConnectedCount(accounts.filter((a) => a.is_connected).length);
		} catch (e) {
			notify.error(e);
		} finally {
			setLoading(false);
		}
	}, []);

	// Hydrate origin + self-attested flags + remembered app id from the browser.
	useEffect(() => {
		setAppUrl(window.location.origin);
		setAppId(localStorage.getItem(APP_ID_KEY) ?? "");
		const flags: Record<string, boolean> = {};
		for (const step of SETUP_STEPS) {
			if (step.completion.kind === "self") {
				flags[step.id] = localStorage.getItem(SELF_KEY(step.id)) === "1";
			}
		}
		setSelfDone(flags);
		load();
	}, [load]);

	const isSet = useCallback(
		(provider: string) =>
			status.some((s) => s.provider === provider && s.is_set),
		[status],
	);

	const isComplete = useCallback(
		(id: SetupStepId): boolean => {
			const step = SETUP_STEPS.find((s) => s.id === id);
			if (!step) return false;
			switch (step.completion.kind) {
				case "settings":
					return isSet(step.completion.provider);
				case "accounts":
					return connectedCount > 0;
				case "self":
					return !!selfDone[id];
			}
		},
		[isSet, connectedCount, selfDone],
	);

	// First incomplete step — where a returning operator picks up. Equals TOTAL
	// when everything is done.
	const firstIncomplete = useMemo(() => {
		const idx = SETUP_STEPS.findIndex((s) => !isComplete(s.id));
		return idx === -1 ? TOTAL : idx;
	}, [isComplete]);

	const allDone = firstIncomplete === TOTAL;

	// Land on the first incomplete step once, after the initial load. From then
	// on, navigation is fully operator-driven (Back/Next).
	useEffect(() => {
		if (!loading && current === null) {
			setCurrent(allDone ? TOTAL - 1 : firstIncomplete);
		}
	}, [loading, current, allDone, firstIncomplete]);

	// --- mutations -------------------------------------------------------

	async function saveSetting(provider: string, value: string) {
		try {
			const res = await apiFetch("/api/settings", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ settings: [{ provider, value }] }),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to save");
			if (provider === "meta_app_id") {
				setAppId(value);
				localStorage.setItem(APP_ID_KEY, value);
			}
			notify.success("Saved");
			// Refresh status so the saved value flips Next from disabled → enabled.
			// We deliberately don't auto-advance: e.g. the webhooks step saves a
			// token but the operator still needs to copy the callback URL here.
			await load();
		} catch (e) {
			notify.error(e);
		}
	}

	async function generateAndSaveToken() {
		await saveSetting("meta_webhook_verify_token", randomVerifyToken());
	}

	function markSelfDone(id: SetupStepId) {
		setSelfDone((prev) => ({ ...prev, [id]: true }));
		localStorage.setItem(SELF_KEY(id), "1");
	}

	const { openOAuthTab } = useOAuthPopup({
		onSuccess: (data) => {
			const n = data.discoveredAccounts?.length ?? 0;
			notify.success(
				n > 0
					? `Connected ${n} account${n === 1 ? "" : "s"}`
					: "Account connected",
			);
			load();
		},
		onError: (msg) => notify.error(msg),
	});

	async function connectMeta() {
		setConnecting(true);
		try {
			const placeholderId = `pending-${crypto.randomUUID()}`;
			const res = await apiFetch("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					platform: "facebook",
					account_id: placeholderId,
					account_name: "Connecting…",
				}),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to start connect");
			await openOAuthTab("facebook", json.data.id);
		} catch (e) {
			notify.error(e);
		} finally {
			setConnecting(false);
		}
	}

	// --- navigation ------------------------------------------------------

	function goNext(step: (typeof SETUP_STEPS)[number], index: number) {
		// Self-attested steps have nothing to verify — advancing IS the
		// confirmation, so record it before moving on.
		if (step.completion.kind === "self") markSelfDone(step.id);
		if (index >= TOTAL - 1) router.push("/automations");
		else setCurrent(index + 1);
	}

	// --- derived display values -----------------------------------------

	const redirectUri = appUrl ? `${appUrl}/oauth/callback` : "";
	const webhookUrl = appUrl ? `${appUrl}/api/webhooks/meta` : "";
	let appHost = "";
	try {
		appHost = appUrl ? new URL(appUrl).host : "";
	} catch {
		appHost = "";
	}
	const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(appUrl);

	function renderBody(id: SetupStepId) {
		switch (id) {
			case "prerequisites":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							Before connecting, confirm you have each of these. They live on
							Meta's side, not here.
						</p>
						<div className="space-y-3">
							{PREREQUISITES.map((p) => (
								<CheckItem
									key={p.key}
									checked={!!prereqChecked[p.key]}
									onChange={(c) =>
										setPrereqChecked((prev) => ({ ...prev, [p.key]: c }))
									}
								>
									{p.label}
								</CheckItem>
							))}
						</div>
					</>
				);
			case "create-app":
				return (
					<p className="text-sm text-muted-foreground">
						Open the{" "}
						<ExtLink href={EXTERNAL_LINKS.appsDashboard}>
							Meta app dashboard
						</ExtLink>
						, click <strong>Create App</strong>, choose the{" "}
						<strong>Business</strong> type, and name it (e.g.{" "}
						<strong>Oh Daddy</strong>).
					</p>
				);
			case "app-id":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							In your app, go to{" "}
							{appId ? (
								<ExtLink href={appBasicSettingsUrl(appId)}>
									App Settings → Basic
								</ExtLink>
							) : (
								<>App Settings → Basic</>
							)}{" "}
							and copy the <strong>App ID</strong>.
						</p>
						<PasteField
							label="Meta App ID"
							provider="meta_app_id"
							placeholder="1234567890"
							isSet={isSet("meta_app_id")}
							onSave={(v) => saveSetting("meta_app_id", v)}
							hint="Saving this unlocks direct links to your app's pages in later steps."
						/>
					</>
				);
			case "app-secret":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							On the same{" "}
							{appId ? (
								<ExtLink href={appBasicSettingsUrl(appId)}>
									App Settings → Basic
								</ExtLink>
							) : (
								<>App Settings → Basic</>
							)}{" "}
							page, click <strong>Show</strong> next to the App Secret and copy
							it.
						</p>
						<PasteField
							label="Meta App Secret"
							provider="meta_app_secret"
							placeholder="••••••••"
							secret
							isSet={isSet("meta_app_secret")}
							onSave={(v) => saveSetting("meta_app_secret", v)}
							hint="Stored encrypted at rest. Also used to verify incoming webhooks."
						/>
					</>
				);
			case "redirect-uri":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							Copy these into your app under{" "}
							{appId ? (
								<ExtLink href={appLoginSettingsUrl(appId)}>
									Facebook Login for Business → Settings
								</ExtLink>
							) : (
								<>Facebook Login for Business → Settings</>
							)}{" "}
							and{" "}
							{appId ? (
								<ExtLink href={appBasicSettingsUrl(appId)}>
									App Settings → Basic
								</ExtLink>
							) : (
								<>App Settings → Basic</>
							)}
							.
						</p>
						<CopyField
							label="Valid OAuth Redirect URI"
							value={redirectUri}
							hint={
								isLocal
									? "You're on localhost — Meta needs a public URL. Expose this with a tunnel (e.g. ngrok) and register that URL instead. Must match exactly."
									: "Paste under Valid OAuth Redirect URIs. Must match exactly (scheme, host, path)."
							}
						/>
						<CopyField
							label="App Domain"
							value={appHost}
							hint="Add under App Settings → Basic → App Domains."
						/>
					</>
				);
			case "config-id":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							Under{" "}
							{appId ? (
								<ExtLink href={appLoginConfigurationsUrl(appId)}>
									Facebook Login for Business → Configurations
								</ExtLink>
							) : (
								<>Facebook Login for Business → Configurations</>
							)}
							, create a configuration with these permissions, then paste its{" "}
							<strong>Configuration ID</strong> below.
						</p>
						<div className="space-y-1.5">
							<div className="flex flex-wrap gap-1.5">
								{PERMISSION_LIST.map((p) => (
									<span
										key={p}
										className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-[11px] text-foreground/80"
									>
										{p}
									</span>
								))}
							</div>
							<CopyField
								label="Permissions (copy all)"
								value={PERMISSION_LIST_TEXT}
							/>
						</div>
						<PasteField
							label="Meta Config ID"
							provider="meta_config_id"
							placeholder="Configuration ID"
							isSet={isSet("meta_config_id")}
							onSave={(v) => saveSetting("meta_config_id", v)}
						/>
					</>
				);
			case "webhooks":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							Generate a verify token, then in your app under{" "}
							{appId ? (
								<ExtLink href={appWebhooksUrl(appId)}>Webhooks</ExtLink>
							) : (
								<>Webhooks</>
							)}{" "}
							paste the callback URL and the same token, and subscribe to{" "}
							<strong>feed</strong> (Pages) and <strong>comments</strong>{" "}
							(Instagram).
						</p>
						<PasteField
							label="Webhook Verify Token"
							provider="meta_webhook_verify_token"
							placeholder="a-random-string-you-choose"
							isSet={isSet("meta_webhook_verify_token")}
							onSave={(v) => saveSetting("meta_webhook_verify_token", v)}
							rightSlot={
								<Button
									variant="outline"
									size="sm"
									onClick={generateAndSaveToken}
								>
									Generate
								</Button>
							}
							hint="Use the exact same value in the Meta webhook setup so the handshake matches."
						/>
						<CopyField
							label="Callback URL"
							value={webhookUrl}
							hint={
								isLocal
									? "You're on localhost — expose this with a tunnel and use that URL in Meta."
									: "Paste into Meta as the webhook callback URL."
							}
						/>
					</>
				);
			case "connect":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							Launch the Meta consent flow in a new tab. When it finishes, your
							Pages and Instagram accounts appear automatically.
						</p>
						<Button onClick={connectMeta} disabled={connecting}>
							{connecting ? "Starting…" : "Connect Meta"}
						</Button>
						{connectedCount > 0 && (
							<p className="text-sm text-success">
								Connected {connectedCount} account
								{connectedCount === 1 ? "" : "s"}. You're all set.
							</p>
						)}
					</>
				);
		}
	}

	// --- render ----------------------------------------------------------

	if (loading || current === null) {
		return (
			<div className="space-y-6">
				<SetupHeader />
				<p className="text-sm text-muted-foreground">Loading…</p>
			</div>
		);
	}

	const step = SETUP_STEPS[current];
	const stepComplete = isComplete(step.id);
	const isLast = current === TOTAL - 1;
	// Prerequisites needs every box ticked (or already completed in a past
	// session) before advancing.
	const prereqsReady =
		stepComplete || PREREQUISITES.every((p) => prereqChecked[p.key]);
	// Settings/accounts steps gate Next until the value is actually saved /
	// connected. Self steps are free to advance (Next = "I did this"), except
	// prerequisites which gates on its checkboxes.
	const nextDisabled =
		step.id === "prerequisites"
			? !prereqsReady
			: step.completion.kind !== "self" && !stepComplete;
	const nextLabel = isLast ? "Finish" : "Next";

	return (
		<div className="space-y-6">
			<SetupHeader />

			{/* Progress: segmented bar + "Step N of M". Each segment is a shortcut
			    back to any step already reached (≤ first incomplete). */}
			<div className="space-y-2">
				<div className="flex items-center gap-1.5">
					{SETUP_STEPS.map((s, i) => {
						const done = isComplete(s.id);
						const reached = i <= firstIncomplete;
						return (
							<button
								key={s.id}
								type="button"
								aria-label={`Go to step ${i + 1}: ${s.title}`}
								disabled={!reached}
								onClick={() => setCurrent(i)}
								className={cn(
									"ring-focus h-1.5 flex-1 rounded-full transition-colors",
									done
										? "bg-primary"
										: i === current
											? "bg-primary/50"
											: "bg-border",
									reached ? "cursor-pointer" : "cursor-default",
								)}
							/>
						);
					})}
				</div>
				<p className="text-xs font-medium text-muted-foreground">
					Step {current + 1} of {TOTAL}
				</p>
			</div>

			<Card>
				<CardContent className="space-y-4 p-6">
					<div className="flex items-center gap-2">
						<h2 className="font-display text-xl font-semibold tracking-tight">
							{step.title}
						</h2>
						{stepComplete && (
							<span className="text-[11px] font-medium uppercase tracking-wide text-success">
								Done
							</span>
						)}
					</div>

					{renderBody(step.id)}

					<div className="flex items-center justify-between border-t border-border/60 pt-4">
						<Button
							variant="ghost"
							onClick={() => setCurrent(Math.max(0, current - 1))}
							disabled={current === 0}
						>
							Back
						</Button>
						<Button
							onClick={() => goNext(step, current)}
							disabled={nextDisabled}
						>
							{nextLabel}
						</Button>
					</div>
				</CardContent>
			</Card>

			{allDone && (
				<Card className="border-success/40">
					<CardContent className="flex flex-col items-start gap-2 p-5">
						<p className="font-display text-base font-semibold">
							Setup complete 🎉
						</p>
						<p className="text-sm text-muted-foreground">
							Everything's connected. Create your first keyword automation.
						</p>
						<Button onClick={() => router.push("/automations")}>
							Go to Automations
						</Button>
					</CardContent>
				</Card>
			)}
		</div>
	);
}

function SetupHeader() {
	return (
		<div className="grid-texture -mx-4 -mt-10 px-4 pb-2 pt-10 sm:-mx-6 sm:px-6">
			<h1 className="font-display text-3xl font-semibold tracking-tight">
				Setup
			</h1>
		</div>
	);
}
