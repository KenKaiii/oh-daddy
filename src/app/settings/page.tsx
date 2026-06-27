"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify } from "@/lib/toast";

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

	const webhookUrl = appUrl ? `${appUrl}/api/webhooks/meta` : "";
	const verifyToken = statusFor("meta_webhook_verify_token");

	return (
		<div className="space-y-6">
			<div className="grid-texture -mx-4 -mt-10 px-4 pb-2 pt-10 sm:-mx-6 sm:px-6">
				<h1 className="font-display text-3xl font-semibold tracking-tight">
					Settings
				</h1>
			</div>

			<div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
				<Card>
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
										{s?.is_set ? (
											<Badge variant="success">
												Set{s.source === "env" ? " (env)" : ""}
											</Badge>
										) : (
											<Badge variant="muted">Not set</Badge>
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

				<Card>
					<CardHeader>
						<CardTitle>Webhook configuration</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4 text-sm">
						<div className="space-y-1.5">
							<span className="flex items-center gap-1.5">
								<Label>Callback URL</Label>
								<InfoTip text="Paste this into your Meta App, Webhooks as the callback URL. For local dev, expose port 3000 with a tunnel like ngrok and use that URL instead." />
							</span>
							<code className="block rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
								{webhookUrl || "…"}
							</code>
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
						<div className="space-y-1.5">
							<span className="flex items-center gap-1.5">
								<Label>Subscribe fields</Label>
								<InfoTip text="Turn these on in the Meta webhook setup so comment and message events reach this app." />
							</span>
							<code className="block rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
								feed, messages (Facebook) / comments, messages (Instagram)
							</code>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
