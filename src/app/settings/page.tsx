"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
		info: "Optional. If set, uses Facebook Login for Business and skips the scope based PKCE flow.",
	},
] as const;

interface StatusRow {
	provider: string;
	is_set: boolean;
	source: "db" | "env" | null;
}

export default function SettingsPage() {
	const [values, setValues] = useState<Record<string, string>>({});
	const [status, setStatus] = useState<StatusRow[]>([]);
	const [saving, setSaving] = useState(false);
	const [appUrl, setAppUrl] = useState("");
	const [generating, setGenerating] = useState(false);
	const [generatedToken, setGeneratedToken] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const res = await fetch("/api/settings");
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to load settings");
			setStatus(json.data ?? []);
		} catch (e) {
			notify.error(e);
		}
	}, []);

	useEffect(() => {
		load();
		setAppUrl(window.location.origin);
	}, [load]);

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
			const res = await fetch("/api/settings", {
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

	// Generate a fresh verify token, save it to the DB, then reveal it once.
	// The settings API never returns saved values, so this is the only chance
	// to copy it.
	async function generateVerifyToken() {
		setGenerating(true);
		try {
			const token = randomVerifyToken();
			const res = await fetch("/api/settings", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					settings: [{ provider: "meta_webhook_verify_token", value: token }],
				}),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to generate token");
			setGeneratedToken(token);
			// Clear any half-typed manual value so the saved one is authoritative.
			setValues((v) => {
				const { meta_webhook_verify_token: _omit, ...rest } = v;
				return rest;
			});
			await load();
		} catch (e) {
			notify.error(e);
		} finally {
			setGenerating(false);
		}
	}

	const webhookUrl = appUrl ? `${appUrl}/api/webhooks/meta` : "";
	const verifyToken = statusFor("meta_webhook_verify_token");
	// localhost needs a public tunnel; a deployed domain is already reachable.
	const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(appUrl);
	const callbackInfo = isLocal
		? "Paste this into your Meta App, Webhooks as the callback URL. You're on localhost, so expose it first with a tunnel like ngrok and use that URL instead."
		: "Paste this into your Meta App, Webhooks as the callback URL. It points at this deployment, so it's ready to use as-is.";

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
						<CardTitle>Meta credentials</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{FIELDS.map((f) => {
							const s = statusFor(f.provider);
							return (
								<div key={f.provider} className="space-y-1.5">
									<div className="flex items-center justify-between">
										<span className="flex items-center gap-1.5">
											<Label htmlFor={f.provider}>{f.label}</Label>
											<InfoTip text={f.info} />
										</span>
										<span className="flex items-center gap-2">
											{f.provider === "meta_webhook_verify_token" && (
												<Button
													variant="outline"
													size="sm"
													onClick={generateVerifyToken}
													disabled={generating}
												>
													{generating ? "Generating…" : "Generate"}
												</Button>
											)}
											{s?.is_set ? (
												<Badge variant="success">
													Set{s.source === "env" ? " (env)" : ""}
												</Badge>
											) : (
												<Badge variant="muted">Not set</Badge>
											)}
										</span>
									</div>
									<Input
										id={f.provider}
										type={f.provider.includes("secret") ? "password" : "text"}
										value={values[f.provider] ?? ""}
										onChange={(e) =>
											setValues({ ...values, [f.provider]: e.target.value })
										}
										placeholder={
											s?.is_set ? "•••••• (leave blank to keep)" : f.placeholder
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
						<CardTitle>Webhook configuration</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4 text-sm">
						<div className="space-y-1.5">
							<span className="flex items-center gap-1.5">
								<Label>Callback URL</Label>
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
						<div className="space-y-1.5">
							<span className="flex items-center gap-1.5">
								<Label>Verify Token</Label>
								<InfoTip text="Meta sends this token during the webhook handshake. It must match the Webhook Verify Token you saved on the left." />
							</span>
							<code className="block rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
								{verifyToken?.is_set
									? "Uses the saved Webhook Verify Token"
									: "Set a Webhook Verify Token first"}
							</code>
						</div>
					</CardContent>
				</Card>
			</div>

			<Dialog
				open={generatedToken !== null}
				onClose={() => setGeneratedToken(null)}
				className="max-w-md"
			>
				<DialogHeader
					title="Your webhook verify token"
					description="Copy it now and keep it safe. For security, you won't be able to view it again."
				/>
				<div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3">
					<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">
						{generatedToken}
					</code>
					<CopyButton
						value={generatedToken ?? ""}
						label="Copy"
						className="shrink-0"
					/>
				</div>
				<p className="mt-3 text-xs text-muted-foreground">
					It's already saved and active. Paste the same value into your Meta App
					webhook setup so the handshake matches.
				</p>
				<DialogFooter>
					<Button onClick={() => setGeneratedToken(null)}>
						Done, I saved it
					</Button>
				</DialogFooter>
			</Dialog>
		</div>
	);
}
