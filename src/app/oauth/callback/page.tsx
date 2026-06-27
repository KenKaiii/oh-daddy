"use client";

import { useEffect, useState } from "react";

type DiscoveredAccount = {
	platform: string;
	account_id: string;
	account_name: string;
};

type OAuthResult = {
	type: "OAUTH_SUCCESS" | "OAUTH_ERROR";
	platform?: string;
	accountId?: string;
	error?: string;
	discoveredAccounts?: DiscoveredAccount[];
};

export default function OAuthCallbackPage() {
	const [status, setStatus] = useState<"loading" | "success" | "error">(
		"loading",
	);
	const [message, setMessage] = useState("");

	useEffect(() => {
		function notifyParent(result: OAuthResult) {
			const targetOrigin = window.opener?.origin ?? window.location.origin;
			if (window.opener && !window.opener.closed) {
				window.opener.postMessage(result, targetOrigin);
			}
		}

		function scheduleClose() {
			setTimeout(() => {
				if (window.opener && !window.opener.closed) window.close();
			}, 2500);
		}

		function summarize(discovered: DiscoveredAccount[]): string {
			if (discovered.length === 0) return "Connected successfully!";
			const pages = discovered.filter((a) => a.platform === "facebook").length;
			const igs = discovered.filter((a) => a.platform === "instagram").length;
			const parts: string[] = [];
			if (pages) parts.push(`${pages} Page${pages === 1 ? "" : "s"}`);
			if (igs) parts.push(`${igs} Instagram account${igs === 1 ? "" : "s"}`);
			return `Connected ${parts.join(" + ")}`;
		}

		async function handleCallback() {
			const params = new URLSearchParams(window.location.search);
			const code = params.get("code");
			const state = params.get("state");
			const oauthError = params.get("error_description") ?? params.get("error");

			if (oauthError) {
				notifyParent({ type: "OAUTH_ERROR", error: oauthError });
				setStatus("error");
				setMessage(oauthError);
				scheduleClose();
				return;
			}

			if (!code || !state) {
				const err = "Missing authorization code or state";
				notifyParent({ type: "OAUTH_ERROR", error: err });
				setStatus("error");
				setMessage(err);
				scheduleClose();
				return;
			}

			try {
				const res = await fetch("/api/oauth/callback", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ code, state }),
				});
				const data = await res.json();
				if (!res.ok) throw new Error(data.error ?? "Token exchange failed");

				const discovered: DiscoveredAccount[] = data.discoveredAccounts ?? [];
				notifyParent({
					type: "OAUTH_SUCCESS",
					platform: data.platform,
					accountId: data.accountId,
					discoveredAccounts: discovered,
				});
				setStatus("success");
				setMessage(summarize(discovered));
				scheduleClose();
			} catch (err) {
				const msg =
					err instanceof Error ? err.message : "Failed to complete auth";
				notifyParent({ type: "OAUTH_ERROR", error: msg });
				setStatus("error");
				setMessage(msg);
				scheduleClose();
			}
		}

		handleCallback();
	}, []);

	return (
		<div className="flex min-h-[60vh] items-center justify-center">
			<div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center shadow-sm">
				{status === "loading" && (
					<>
						<p className="text-lg font-medium">Connecting…</p>
						<p className="mt-2 text-sm text-muted-foreground">
							Completing authentication
						</p>
					</>
				)}
				{status === "success" && (
					<>
						<p className="text-lg font-medium text-success">Connected!</p>
						<p className="mt-2 text-sm text-muted-foreground">{message}</p>
						<p className="mt-4 text-xs text-muted-foreground">
							This window will close automatically.
						</p>
					</>
				)}
				{status === "error" && (
					<>
						<p className="text-lg font-medium text-destructive">
							Connection failed
						</p>
						<p className="mt-2 text-sm text-muted-foreground">{message}</p>
						<p className="mt-4 text-xs text-muted-foreground">
							This window will close automatically.
						</p>
					</>
				)}
			</div>
		</div>
	);
}
