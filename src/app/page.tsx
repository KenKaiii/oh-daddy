"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";

interface Stats {
	connectedAccounts: number;
	activeAutomations: number;
	comments: { allTime: number; last7d: number };
	repliesSent: { allTime: number; last7d: number };
	dmsSent: { allTime: number; last7d: number };
}

function StatCard({
	label,
	value,
	sub,
	accent,
}: {
	label: string;
	value: number | string;
	sub?: string;
	accent?: boolean;
}) {
	return (
		<Card className="glass-hover p-5">
			<div className="flex items-center gap-2">
				<span
					className={
						accent
							? "h-1.5 w-1.5 rounded-full bg-primary"
							: "h-1.5 w-1.5 rounded-full bg-foreground/25"
					}
				/>
				<p className="text-[13px] font-medium text-muted-foreground">{label}</p>
			</div>
			<p className="font-display mt-3 text-4xl font-semibold tabular-nums tracking-tight">
				{value}
			</p>
			{sub && <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>}
		</Card>
	);
}

export default function DashboardPage() {
	const router = useRouter();
	const [stats, setStats] = useState<Stats | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	// Incomplete = any Meta credential unset OR no account connected. Drives the
	// banner that nudges a freshly-deployed operator into the guided setup.
	const [setupIncomplete, setSetupIncomplete] = useState(false);

	useEffect(() => {
		apiFetch("/api/stats")
			.then(async (r) => {
				const json = await r.json();
				if (!r.ok) throw new Error(json.error ?? "Failed to load stats");
				return json;
			})
			.then((json) => setStats(json.data))
			.catch((e) => setError(e.message))
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		apiFetch("/api/settings")
			.then(async (r) => {
				if (!r.ok) return;
				const json = await r.json();
				const rows: { is_set: boolean }[] = json.data ?? [];
				const credsMissing = rows.some((row) => !row.is_set);
				const accountsRes = await apiFetch("/api/accounts");
				const accountsJson = await accountsRes.json().catch(() => ({}));
				const accounts: { is_connected: boolean }[] = accountsJson.data ?? [];
				const noAccounts = accounts.filter((a) => a.is_connected).length === 0;
				setSetupIncomplete(credsMissing || noAccounts);
			})
			.catch(() => {
				// Non-fatal — the banner just stays hidden if status can't load.
			});
	}, []);

	return (
		<div className="space-y-8">
			<div className="grid-texture -mx-4 -mt-10 px-4 pb-2 pt-10 sm:-mx-6 sm:px-6">
				<h1 className="font-display text-3xl font-semibold tracking-tight">
					Dashboard
				</h1>
			</div>

			{setupIncomplete && (
				<Card className="glass-hover border-primary/40">
					<CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p className="font-display text-base font-semibold">
								Finish setting up Oh Daddy
							</p>
							<p className="mt-1 text-sm text-muted-foreground">
								Connect Meta and add your credentials to start running
								automations.
							</p>
						</div>
						<Button className="shrink-0" onClick={() => router.push("/setup")}>
							Open setup
						</Button>
					</CardContent>
				</Card>
			)}

			{error && (
				<Card>
					<CardContent className="p-5 text-sm text-destructive">
						{error}
						<p className="mt-1 text-xs text-muted-foreground">
							Make sure DATABASE_URL is set and db/schema.sql is applied.
						</p>
					</CardContent>
				</Card>
			)}

			{loading && !error && (
				<p className="text-sm text-muted-foreground">Loading…</p>
			)}

			{stats && (
				<>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<StatCard
							label="Connected accounts"
							value={stats.connectedAccounts}
							accent
						/>
						<StatCard
							label="Active automations"
							value={stats.activeAutomations}
							accent
						/>
					</div>

					<div>
						<h2 className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
							Last 7 days
						</h2>
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
							<StatCard
								label="Comments received"
								value={stats.comments.last7d}
								sub={`${stats.comments.allTime} all-time`}
							/>
							<StatCard
								label="Replies sent"
								value={stats.repliesSent.last7d}
								sub={`${stats.repliesSent.allTime} all-time`}
							/>
							<StatCard
								label="DMs sent"
								value={stats.dmsSent.last7d}
								sub={`${stats.dmsSent.allTime} all-time`}
							/>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
