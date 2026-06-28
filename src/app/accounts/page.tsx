"use client";

import { useCallback, useEffect, useState } from "react";

import { PlatformIcon } from "@/components/platform-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { apiFetch } from "@/lib/api-client";
import { notify } from "@/lib/toast";
import { formatError } from "@/lib/utils";

import { useOAuthPopup } from "./_hooks/use-oauth-popup";

interface Account {
	id: string;
	platform: string;
	account_name: string;
	is_connected: boolean;
}

export default function AccountsPage() {
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [connecting, setConnecting] = useState(false);
	const confirm = useConfirm();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const res = await apiFetch("/api/accounts");
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to load accounts");
			setAccounts(json.data ?? []);
			setError(null);
		} catch (e) {
			setError(formatError(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

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
		setError(null);
		try {
			// Create a placeholder account row to anchor the OAuth state, then
			// launch the Meta consent flow. Discovery replaces it with the real
			// Pages + IG accounts on callback.
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

	async function disconnect(a: Account) {
		const ok = await confirm({
			title: "Disconnect account?",
			description: `${a.account_name} will stop receiving comments. You can reconnect anytime.`,
			confirmText: "Disconnect",
			destructive: true,
		});
		if (!ok) return;
		try {
			const res = await apiFetch(`/api/accounts/${a.id}`, { method: "DELETE" });
			if (!res.ok) {
				const json = await res.json().catch(() => ({}));
				throw new Error(json.error ?? "Failed to disconnect");
			}
			setAccounts((prev) => prev.filter((x) => x.id !== a.id));
			notify.success("Account disconnected");
		} catch (e) {
			notify.error(e);
		}
	}

	const connected = accounts.filter((a) => a.is_connected);

	return (
		<div className="space-y-6">
			<div className="grid-texture -mx-4 -mt-10 flex items-center justify-between px-4 pb-2 pt-10 sm:-mx-6 sm:px-6">
				<h1 className="font-display text-3xl font-semibold tracking-tight">
					Accounts
				</h1>
				<Button onClick={connectMeta} disabled={connecting}>
					{connecting ? "Starting…" : "Connect Meta"}
				</Button>
			</div>

			{error && (
				<Card>
					<CardContent className="p-4 text-sm text-destructive">
						{error}
					</CardContent>
				</Card>
			)}

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : connected.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center p-10 text-center">
						<Button onClick={connectMeta} disabled={connecting}>
							Connect Meta
						</Button>
						<p className="mt-4 text-sm text-muted-foreground">
							No accounts connected yet.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{connected.map((a) => (
						<Card key={a.id} className="glass-hover flex flex-col">
							<CardContent className="flex flex-1 flex-col gap-4 p-5">
								<div className="flex items-center gap-3">
									<PlatformIcon platform={a.platform} />
									<div className="min-w-0">
										<p className="truncate font-display font-semibold">
											{a.account_name}
										</p>
										<p className="text-xs capitalize text-muted-foreground">
											{a.platform}
										</p>
									</div>
								</div>

								<Badge variant="success" className="w-fit">
									● Connected
								</Badge>

								<div className="mt-auto border-t border-border/60 pt-3">
									<Button
										variant="ghost"
										size="sm"
										className="w-full text-destructive"
										onClick={() => disconnect(a)}
									>
										Disconnect
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
