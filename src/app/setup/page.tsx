"use client";

import { useRouter } from "next/navigation";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";
import {
	appBasicSettingsUrl,
	appInstagramSetupUrl,
	appLoginConfigurationsUrl,
	appLoginSettingsUrl,
	appWebhooksUrl,
	EXTERNAL_LINKS,
	INSTAGRAM_PERMISSION_LIST,
	PERMISSION_LIST,
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
		key: "ig-business",
		label: (
			<>
				An{" "}
				<ExtLink href={EXTERNAL_LINKS.instagramBusiness}>
					Instagram professional account
				</ExtLink>{" "}
				(Business or Creator). This is all you need for Instagram.
			</>
		),
	},
	{
		key: "fb-account",
		label: (
			<>
				Optional, for Facebook Pages: a{" "}
				<ExtLink href={EXTERNAL_LINKS.facebookSignup}>Facebook account</ExtLink>{" "}
				and a <ExtLink href={EXTERNAL_LINKS.createPage}>Page</ExtLink> you
				manage.
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
	const [connecting, setConnecting] = useState<"facebook" | "instagram" | null>(
		null,
	);
	const [loading, setLoading] = useState(true);
	const confirm = useConfirm();
	// The verify token generated in THIS session, kept so it can be re-copied on a
	// later step (e.g. the Facebook webhooks step reuses the same token). Lost on
	// reload — GET /api/settings never returns the stored secret.
	const [generatedVerifyToken, setGeneratedVerifyToken] = useState("");
	const [tokenModalOpen, setTokenModalOpen] = useState(false);
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

	// Honest per-step "done" state — drives the Done badge + progress dots.
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

	// Whether a step no longer blocks progress. Optional (Facebook) steps are
	// always resolved so an Instagram-only operator can skip the whole group.
	const isResolved = useCallback(
		(id: SetupStepId): boolean => {
			const step = SETUP_STEPS.find((s) => s.id === id);
			if (!step) return false;
			return !!step.optional || isComplete(id);
		},
		[isComplete],
	);

	// First unresolved step — where a returning operator picks up. Equals TOTAL
	// when everything required is done.
	const firstIncomplete = useMemo(() => {
		const idx = SETUP_STEPS.findIndex((s) => !isResolved(s.id));
		return idx === -1 ? TOTAL : idx;
	}, [isResolved]);

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
			await load();
		} catch (e) {
			notify.error(e);
		}
	}

	async function generateAndSaveToken() {
		// One token is shared by both the Instagram and Page webhooks. If one already
		// exists, regenerating silently breaks any webhook already registered with
		// the old value — so confirm before overwriting.
		if (isSet("meta_webhook_verify_token")) {
			const ok = await confirm({
				title: "Replace the verify token?",
				description:
					"A token is already saved and is shared by the Instagram and Facebook webhooks. Generating a new one breaks any webhook you've already registered until you update it in Meta with the new value. To set up Facebook, reuse the existing token instead.",
				confirmText: "Regenerate anyway",
				destructive: true,
			});
			if (!ok) return;
		}
		const token = randomVerifyToken();
		await saveSetting("meta_webhook_verify_token", token);
		// Surface the value so the operator can paste the SAME token into Meta.
		setGeneratedVerifyToken(token);
		setTokenModalOpen(true);
	}

	// Convenience: Meta's Instagram business-login settings show a ready-made
	// authorize URL (the “embed” link) with the app's client_id baked in. Let the
	// operator paste that whole URL; we pull out client_id and store it as the
	// Instagram App ID. We deliberately don't persist the URL itself — the connect
	// flow builds its own authorize URL with a fresh CSRF state each time.
	async function saveAppIdFromLoginUrl(raw: string) {
		let clientId: string | null = null;
		try {
			clientId = new URL(raw.trim()).searchParams.get("client_id");
		} catch {
			clientId = null;
		}
		if (!clientId || !/^\d+$/.test(clientId)) {
			notify.error(
				"Couldn't find a client_id in that URL. Paste the full Instagram login URL Meta shows.",
			);
			return;
		}
		await saveSetting("instagram_app_id", clientId);
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

	async function connect(platform: "facebook" | "instagram") {
		setConnecting(platform);
		try {
			const placeholderId = `pending-${crypto.randomUUID()}`;
			const res = await apiFetch("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					platform,
					account_id: placeholderId,
					account_name: "Connecting…",
				}),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to start connect");
			await openOAuthTab(platform, json.data.id);
		} catch (e) {
			notify.error(e);
		} finally {
			setConnecting(null);
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

	const tokenIsSet = isSet("meta_webhook_verify_token");
	const verifyTokenField = (
		<PasteField
			label="Webhook Verify Token"
			provider="meta_webhook_verify_token"
			placeholder="a-random-string-you-choose"
			isSet={tokenIsSet}
			onSave={(v) => saveSetting("meta_webhook_verify_token", v)}
			rightSlot={
				<span className="flex items-center gap-2">
					{tokenIsSet && generatedVerifyToken && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => setTokenModalOpen(true)}
						>
							Copy token
						</Button>
					)}
					<Button variant="outline" size="sm" onClick={generateAndSaveToken}>
						{tokenIsSet ? "Regenerate" : "Generate"}
					</Button>
				</span>
			}
			hint={
				tokenIsSet
					? "One token is shared by the Instagram and Page webhooks — reuse the same value for both. Only regenerate if you'll update every registered webhook with the new value."
					: "Use the exact same value in the Meta webhook setup so the handshake matches. The same token works for both the Instagram and Page objects."
			}
		/>
	);

	function renderBody(id: SetupStepId) {
		switch (id) {
			case "prerequisites":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							Instagram and Facebook are two independent connections. You only
							need the Instagram items below; the Facebook ones are optional.
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
					<>
						<p className="text-sm text-muted-foreground">
							Open the{" "}
							<ExtLink href={EXTERNAL_LINKS.appsDashboard}>
								Meta app dashboard
							</ExtLink>
							, click <strong>Create App</strong>, choose the{" "}
							<strong>Business</strong> type, and name it (e.g.{" "}
							<strong>Oh Daddy</strong>).
						</p>
						<ul className="space-y-2">
							<li className="rounded-md border border-border/60 bg-muted/40 px-3 py-2">
								<p className="text-sm font-medium text-foreground">
									Add the Instagram use case
								</p>
								<p className="text-xs text-muted-foreground">
									Under <strong>Use cases</strong>, add{" "}
									<strong>Manage messaging &amp; content on Instagram</strong>,
									then customize it and choose{" "}
									<strong>API setup with Instagram login</strong>. This lets
									people log in directly with an Instagram professional account
									— no Facebook Page required.
								</p>
							</li>
							<li className="rounded-md border border-border/60 bg-muted/40 px-3 py-2">
								<p className="text-sm font-medium text-foreground">
									Optional: Facebook Login for Business
								</p>
								<p className="text-xs text-muted-foreground">
									Only add this if you also want to connect Facebook Pages.
								</p>
							</li>
						</ul>
					</>
				);
			// ── Instagram (required) ─────────────────────────────────────
			case "ig-app-id":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							In your app, open <strong>Use cases</strong> →{" "}
							<strong>Manage messaging &amp; content on Instagram</strong> →{" "}
							{appId ? (
								<ExtLink href={appInstagramSetupUrl(appId)}>
									API setup with Instagram login
								</ExtLink>
							) : (
								<>API setup with Instagram login</>
							)}
							. Copy the <strong>Instagram app ID</strong> shown there.
						</p>
						<PasteField
							label="Instagram App ID"
							provider="instagram_app_id"
							placeholder="1234567890"
							isSet={isSet("instagram_app_id")}
							onSave={(v) => saveSetting("instagram_app_id", v)}
						/>
						<div className="space-y-1.5">
							<p className="text-xs text-muted-foreground">
								Connecting requests these Instagram permissions automatically:
							</p>
							<div className="flex flex-wrap gap-1.5">
								{INSTAGRAM_PERMISSION_LIST.map((p) => (
									<span
										key={p}
										className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-[11px] text-foreground/80"
									>
										{p}
									</span>
								))}
							</div>
						</div>
					</>
				);
			case "ig-app-secret":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							On the same{" "}
							{appId ? (
								<ExtLink href={appInstagramSetupUrl(appId)}>
									API setup with Instagram login
								</ExtLink>
							) : (
								<>API setup with Instagram login</>
							)}{" "}
							tab, reveal and copy the <strong>Instagram app secret</strong>.
						</p>
						<PasteField
							label="Instagram App Secret"
							provider="instagram_app_secret"
							placeholder="••••••••"
							secret
							isSet={isSet("instagram_app_secret")}
							onSave={(v) => saveSetting("instagram_app_secret", v)}
							hint="Stored encrypted at rest. Also used to verify incoming Instagram webhooks."
						/>
					</>
				);
			case "ig-redirect-uri":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							In the same{" "}
							{appId ? (
								<ExtLink href={appInstagramSetupUrl(appId)}>
									API setup with Instagram login
								</ExtLink>
							) : (
								<>API setup with Instagram login</>
							)}{" "}
							tab, find <strong>Set up Instagram business login</strong> and
							open its settings.
						</p>
						<CopyField
							label="OAuth Redirect URI"
							value={redirectUri}
							hint={
								<>
									Paste under <strong>Business login settings</strong> →{" "}
									<strong>OAuth redirect URIs</strong>, then save.{" "}
									{isLocal
										? "You're on localhost — Meta needs a public URL, so expose this with a tunnel (e.g. ngrok) and register that URL instead. Must match exactly."
										: "Must match exactly (scheme, host, path)."}
								</>
							}
						/>
						<PasteField
							label="Instagram login URL (optional shortcut)"
							provider="instagram_app_id"
							placeholder="https://www.instagram.com/oauth/authorize?client_id=…"
							isSet={isSet("instagram_app_id")}
							onSave={saveAppIdFromLoginUrl}
							hint="After you save the redirect URI, Meta shows a ready-made login URL. Paste it here and we'll pull your Instagram App ID out of it (we don't store the URL itself). The Set badge reflects your App ID."
						/>
					</>
				);
			case "ig-webhooks":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							Generate a verify token, then in the same{" "}
							{appId ? (
								<ExtLink href={appInstagramSetupUrl(appId)}>
									API setup with Instagram login
								</ExtLink>
							) : (
								<>API setup with Instagram login</>
							)}{" "}
							tab, open the <strong>Webhooks</strong> section (“Get real-time
							notifications”). Paste the callback URL and token, verify, then
							subscribe to the <strong>comments</strong> field.
						</p>
						{verifyTokenField}
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
			// ── Facebook Page (optional) ─────────────────────────────────
			case "fb-app-id":
				return (
					<>
						<p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
							Everything from here to the Connect step is{" "}
							<strong>optional</strong> and only needed to connect Facebook
							Pages. Instagram-only? Click <strong>Next</strong> to skip
							straight to Connect.
						</p>
						<p className="text-sm text-muted-foreground">
							Go to{" "}
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
			case "fb-app-secret":
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
							hint="Stored encrypted at rest. Also used to verify incoming Page webhooks."
						/>
					</>
				);
			case "fb-redirect-uri":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							Two values go in two different places in your app. Copy each into
							the spot named below, then save there.
						</p>
						<CopyField
							label="Valid OAuth Redirect URI"
							value={redirectUri}
							hint={
								<>
									Add under{" "}
									{appId ? (
										<ExtLink href={appLoginSettingsUrl(appId)}>
											Facebook Login for Business → Settings
										</ExtLink>
									) : (
										<>Facebook Login for Business → Settings</>
									)}{" "}
									→ <strong>Valid OAuth Redirect URIs</strong>, then click{" "}
									<strong>Save changes</strong>.{" "}
									{isLocal
										? "You're on localhost — register a public tunnel URL instead. Must match exactly."
										: "Must match exactly (scheme, host, path)."}
								</>
							}
						/>
						<CopyField
							label="App Domain"
							value={appHost}
							hint={
								<>
									Add under{" "}
									{appId ? (
										<ExtLink href={appBasicSettingsUrl(appId)}>
											App Settings → Basic
										</ExtLink>
									) : (
										<>App Settings → Basic</>
									)}{" "}
									→ <strong>App Domains</strong>, then save.
								</>
							}
						/>
					</>
				);
			case "fb-config-id":
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
							, create a configuration, then paste its{" "}
							<strong>Configuration ID</strong> below.
						</p>
						<div className="space-y-1.5">
							<p className="text-xs text-muted-foreground">
								Confirm these permissions are selected on the configuration:
							</p>
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
			case "fb-webhooks":
				return (
					<>
						<p className="text-sm text-muted-foreground">
							Generate or reuse the verify token, then open{" "}
							{appId ? (
								<ExtLink href={appWebhooksUrl(appId)}>Webhooks</ExtLink>
							) : (
								<>Webhooks</>
							)}{" "}
							and pick the <strong>Page</strong> object. Paste the callback URL
							and token, verify, then subscribe to the <strong>feed</strong>{" "}
							field.
						</p>
						{verifyTokenField}
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
							Launch a native login in a new tab. Instagram and Facebook are
							separate — connect whichever you set up.
						</p>
						<div className="flex flex-wrap gap-3">
							<Button
								onClick={() => connect("instagram")}
								disabled={connecting !== null}
							>
								{connecting === "instagram" ? "Starting…" : "Connect Instagram"}
							</Button>
							<Button
								variant="outline"
								onClick={() => connect("facebook")}
								disabled={connecting !== null}
							>
								{connecting === "facebook"
									? "Starting…"
									: "Connect Facebook Page"}
							</Button>
						</div>
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
	// Prerequisites needs the Instagram box ticked (or already completed in a past
	// session) before advancing.
	const prereqsReady = stepComplete || !!prereqChecked["ig-business"];
	// Settings/accounts steps gate Next until the value is actually saved /
	// connected — unless the step is optional (Facebook group), which can always
	// be skipped. Self steps are free to advance (Next = "I did this").
	const nextDisabled =
		step.id === "prerequisites"
			? !prereqsReady
			: !step.optional && step.completion.kind !== "self" && !stepComplete;
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
						{stepComplete && <Badge variant="positive">Done</Badge>}
						{!stepComplete && step.optional && (
							<Badge variant="muted">Optional</Badge>
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

			{/* The token is already saved to the system. This modal surfaces it for
			    copying into Meta — the same value for both the Instagram and Page
			    webhooks. Re-openable via “Copy token” during the session, but not after
			    a reload (GET /api/settings doesn't return secrets). */}
			<Dialog open={tokenModalOpen} onClose={() => setTokenModalOpen(false)}>
				<DialogHeader
					title="Webhook verify token"
					description="Saved to this app already. Paste this exact value as the Verify Token in BOTH the Instagram and Facebook webhook setups — it's the same token for both. It won't be retrievable after you leave setup."
				/>
				<div className="flex items-center gap-2">
					<Input
						readOnly
						value={generatedVerifyToken}
						className="font-mono text-xs"
					/>
					<CopyButton value={generatedVerifyToken} />
				</div>
				<DialogFooter>
					<Button onClick={() => setTokenModalOpen(false)}>Done</Button>
				</DialogFooter>
			</Dialog>
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
