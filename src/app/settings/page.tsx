"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { notify } from "@/lib/toast";

/** Generate a URL-safe random verify token (48 hex chars / 24 bytes). */
function randomVerifyToken(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const FIELDS = [
	{
		provider: "meta_app_id",
		label: "Meta App ID",
		placeholder: "1234567890",
		info: "Found in your Meta App dashboard under App Settings, Basic. Used to start the OAuth connect flow.",
	},
	{
		provider: "meta_app_secret",
		label: "Meta App Secret",
		placeholder: "••••••••",
		info: "The secret next to your App ID in App Settings, Basic. Also signs incoming webhooks. Keep it private.",
	},
	{
		provider: "meta_webhook_verify_token",
		label: "Webhook Verify Token",
		placeholder: "a-random-string-you-choose",
		info: "Any random string you pick. Paste the same value into the Meta webhook setup so the handshake matches.",
	},
	{
		provider: "meta_config_id",
		label: "Meta Config ID",
		placeholder: "Facebook Login for Business config id",
		info: "Found under Facebook Login for Business, Configurations. Create a configuration, then paste its Configuration ID here.",
	},
] as const;

interface StatusRow {
	provider: string;
	is_set: boolean;
}

// Smart-delay window. Floor is fixed; operators raise the ceiling up to this.
const DELAY_MIN = 10;
const DELAY_CEILING = 55;

export default function SettingsPage() {
	const [values, setValues] = useState<Record<string, string>>({});
	const [status, setStatus] = useState<StatusRow[]>([]);
	const [saving, setSaving] = useState(false);
	const [appUrl, setAppUrl] = useState("");
	const [delayMax, setDelayMax] = useState(25);
	const [savingDelay, setSavingDelay] = useState(false);

	const load = useCallback(async () => {
		try {
			const [res, delayRes] = await Promise.all([
				apiFetch("/api/settings"),
				apiFetch("/api/settings/delay"),
			]);
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to load settings");
			setStatus(json.data ?? []);
			const delayJson = await delayRes.json();
			if (delayRes.ok && typeof delayJson.data?.max === "number") {
				setDelayMax(delayJson.data.max);
			}
		} catch (e) {
			notify.error(e);
		}
	}, []);

	useEffect(() => {
		load();
		setAppUrl(window.location.origin);
	}, [load]);

	async function saveDelay() {
		setSavingDelay(true);
		try {
			const res = await apiFetch("/api/settings/delay", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ max: delayMax }),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to save");
			if (typeof json.data?.max === "number") setDelayMax(json.data.max);
			notify.success("Send delay saved");
		} catch (e) {
			notify.error(e);
		} finally {
			setSavingDelay(false);
		}
	}

	function statusFor(provider: string): StatusRow | undefined {
		return status.find((s) => s.provider === provider);
	}

	async function save() {
		setSaving(true);
		try {
			const settings = Object.entries(values)
				.filter(([, v]) => v.trim() !== "")
				.map(([provider, value]) => ({ provider, value }));
			if (settings.length === 0) {
				notify.info("Nothing to save. Enter a value first.");
				return;
			}
			const res = await apiFetch("/api/settings", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ settings }),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to save");
			notify.success("Settings saved");
			setValues({});
			await load();
		} catch (e) {
			notify.error(e);
		} finally {
			setSaving(false);
		}
	}

	// "Generate" mints a strong random verify token straight into the input so
	// the operator can review it and click Save. Use the same value in the Meta
	// App webhook setup so the handshake matches.
	function generateVerifyToken() {
		setValues((v) => ({
			...v,
			meta_webhook_verify_token: randomVerifyToken(),
		}));
	}

	const webhookUrl = appUrl ? `${appUrl}/api/webhooks/meta` : "";
	const redirectUri = appUrl ? `${appUrl}/oauth/callback` : "";
	// localhost needs a public tunnel; a deployed domain is already reachable.
	const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(appUrl);
	const callbackInfo = isLocal
		? "Paste this into your Meta App, Webhooks as the callback URL. You're on localhost, so expose it first with a tunnel like ngrok and use that URL instead."
		: "Paste this into your Meta App, Webhooks as the callback URL. It points at this deployment, so it's ready to use as-is.";
	const redirectInfo = isLocal
		? "Add this exact URL under Meta App, Facebook Login, Settings as a Valid OAuth Redirect URI. You're on localhost, so whitelist this localhost URL (or your tunnel URL if you connect through one)."
		: "Add this exact URL under Meta App, Facebook Login, Settings as a Valid OAuth Redirect URI. It must match exactly (scheme, host, and path) or the connect flow is rejected.";

	return (
		<div className="space-y-6">
			<div className="grid-texture -mx-4 -mt-10 px-4 pb-2 pt-10 sm:-mx-6 sm:px-6">
				<h1 className="font-display text-3xl font-semibold tracking-tight">
					Settings
				</h1>
			</div>

			<div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
				<Card className="glass-hover">
					<CardHeader>
						<CardTitle>Send delays</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<p className="text-sm text-muted-foreground">
							When a comment matches, the reply + DM are sent after a random
							wait so you don't blast the Meta API. Each connected account sends
							one action per interval — multiple accounts run in parallel.
						</p>
						<div className="space-y-1.5">
							<span className="flex items-center gap-1.5">
								<Label htmlFor="delay-max">
									Delay window: {DELAY_MIN}–{delayMax}s
								</Label>
								<InfoTip text="The floor is fixed at 10 seconds. Set the upper bound (up to 55s). Each send waits a random whole number of seconds in this range." />
							</span>
							<input
								id="delay-max"
								type="range"
								min={DELAY_MIN}
								max={DELAY_CEILING}
								value={delayMax}
								onChange={(e) => setDelayMax(Number(e.target.value))}
								className="w-full accent-[var(--primary)]"
							/>
							<p className="text-xs text-muted-foreground">
								Sends wait a random {DELAY_MIN}–{delayMax} seconds. Max {""}
								{DELAY_CEILING}s.
							</p>
						</div>
						<Button onClick={saveDelay} disabled={savingDelay}>
							{savingDelay ? "Saving…" : "Save send delay"}
						</Button>
					</CardContent>
				</Card>

				<div className="space-y-6">
					<Card className="glass-hover">
						<CardHeader>
							<CardTitle>Meta credentials</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							{FIELDS.map((f) => {
								const s = statusFor(f.provider);
								return (
									<div key={f.provider} className="space-y-1.5">
										<div className="flex items-center justify-between gap-2">
											<span className="flex items-center gap-1.5">
												<Label htmlFor={f.provider}>{f.label}</Label>
												<InfoTip text={f.info} />
												{s?.is_set ? (
													<Badge variant="positive">Set</Badge>
												) : (
													<Badge variant="muted">Not set</Badge>
												)}
											</span>
											{f.provider === "meta_webhook_verify_token" && (
												<Button
													variant="outline"
													size="sm"
													onClick={generateVerifyToken}
												>
													Generate
												</Button>
											)}
										</div>
										<Input
											id={f.provider}
											type={f.provider.includes("secret") ? "password" : "text"}
											value={values[f.provider] ?? ""}
											onChange={(e) =>
												setValues({ ...values, [f.provider]: e.target.value })
											}
											placeholder={
												s?.is_set
													? "•••••• (leave blank to keep)"
													: f.placeholder
											}
										/>
									</div>
								);
							})}

							<Button onClick={save} disabled={saving}>
								{saving ? "Saving…" : "Save credentials"}
							</Button>
						</CardContent>
					</Card>

					<Card className="glass-hover">
						<CardHeader>
							<CardTitle>Meta App configuration</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4 text-sm">
							<div className="space-y-1.5">
								<span className="flex items-center gap-1.5">
									<Label>OAuth Redirect URI</Label>
									<InfoTip text={redirectInfo} />
								</span>
								<div className="group relative">
									<Input
										readOnly
										value={redirectUri}
										placeholder="…"
										className="pr-20 font-mono text-xs"
									/>
									<CopyButton
										value={redirectUri}
										className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100"
									/>
								</div>
							</div>
							<div className="space-y-1.5">
								<span className="flex items-center gap-1.5">
									<Label>Webhook Callback URL</Label>
									<InfoTip text={callbackInfo} />
								</span>
								<div className="group relative">
									<Input
										readOnly
										value={webhookUrl}
										placeholder="…"
										className="pr-20 font-mono text-xs"
									/>
									<CopyButton
										value={webhookUrl}
										className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100"
									/>
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
