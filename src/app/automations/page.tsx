"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/lib/toast";
import { formatError } from "@/lib/utils";

interface AccountLite {
	id: string;
	platform: string;
	account_name: string;
}

interface Automation {
	id: string;
	name: string;
	is_active: boolean;
	keywords: string[];
	fuzzy_threshold: number;
	comment_replies: string[];
	dm_message: string;
	dm_link: string | null;
	match_count: number;
	platform_account_id: string | null;
	scope: "meta" | null;
	platform_account: AccountLite | null;
}

interface FormState {
	name: string;
	keywords: string;
	fuzzy_threshold: number;
	comment_replies: string[];
	dm_message: string;
	dm_link: string;
	is_active: boolean;
	target: string; // "meta" | account uuid
}

const EMPTY_FORM: FormState = {
	name: "",
	keywords: "",
	fuzzy_threshold: 2,
	comment_replies: [""],
	dm_message: "",
	dm_link: "",
	is_active: true,
	target: "meta",
};

export default function AutomationsPage() {
	const [automations, setAutomations] = useState<Automation[]>([]);
	const [accounts, setAccounts] = useState<AccountLite[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<Automation | null>(null);
	const [form, setForm] = useState<FormState>(EMPTY_FORM);
	const [saving, setSaving] = useState(false);
	const confirm = useConfirm();

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [aRes, accRes] = await Promise.all([
				fetch("/api/automations"),
				fetch("/api/accounts"),
			]);
			const aJson = await aRes.json();
			const accJson = await accRes.json();
			if (!aRes.ok)
				throw new Error(aJson.error ?? "Failed to load automations");
			setAutomations(aJson.data ?? []);
			setAccounts(accJson.data ?? []);
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

	function openCreate() {
		setEditing(null);
		setForm(EMPTY_FORM);
		setDialogOpen(true);
	}

	function openEdit(a: Automation) {
		setEditing(a);
		setForm({
			name: a.name,
			keywords: a.keywords.join(", "),
			fuzzy_threshold: a.fuzzy_threshold,
			comment_replies: a.comment_replies.length ? a.comment_replies : [""],
			dm_message: a.dm_message,
			dm_link: a.dm_link ?? "",
			is_active: a.is_active,
			target: a.scope === "meta" ? "meta" : (a.platform_account_id ?? "meta"),
		});
		setDialogOpen(true);
	}

	async function toggleActive(a: Automation) {
		const next = !a.is_active;
		setAutomations((prev) =>
			prev.map((x) => (x.id === a.id ? { ...x, is_active: next } : x)),
		);
		try {
			const res = await fetch(`/api/automations/${a.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ is_active: next }),
			});
			if (res.status === 404) {
				// Row was deleted elsewhere — drop the stale card and resync.
				notify.error("That automation no longer exists");
				await load();
				return;
			}
			if (!res.ok) {
				const json = await res.json().catch(() => ({}));
				throw new Error(json.error ?? "Failed to update");
			}
			notify.success(next ? "Automation activated" : "Automation paused");
		} catch (e) {
			// Revert the optimistic toggle.
			setAutomations((prev) =>
				prev.map((x) => (x.id === a.id ? { ...x, is_active: !next } : x)),
			);
			notify.error(e);
		}
	}

	async function remove(a: Automation) {
		const ok = await confirm({
			title: "Delete automation?",
			description: `"${a.name}" will be removed. This can't be undone.`,
			confirmText: "Delete",
			destructive: true,
		});
		if (!ok) return;
		try {
			const res = await fetch(`/api/automations/${a.id}`, { method: "DELETE" });
			// Treat 404 as already-gone: the end state (row absent) is the same.
			if (!res.ok && res.status !== 404) {
				const json = await res.json().catch(() => ({}));
				throw new Error(json.error ?? "Failed to delete");
			}
			setAutomations((prev) => prev.filter((x) => x.id !== a.id));
			notify.success("Automation deleted");
		} catch (e) {
			notify.error(e);
		}
	}

	async function save() {
		const wasEditing = editing !== null;
		setSaving(true);
		try {
			const keywords = form.keywords
				.split(",")
				.map((k) => k.trim())
				.filter(Boolean);
			const comment_replies = form.comment_replies
				.map((r) => r.trim())
				.filter(Boolean);

			const isScope = form.target === "meta";
			const payload = {
				name: form.name,
				keywords,
				fuzzy_threshold: form.fuzzy_threshold,
				comment_replies,
				dm_message: form.dm_message,
				dm_link: form.dm_link.trim() ? form.dm_link.trim() : null,
				is_active: form.is_active,
				platform_account_id: isScope ? null : form.target,
				scope: isScope ? "meta" : null,
			};

			const url = editing
				? `/api/automations/${editing.id}`
				: "/api/automations";
			const method = editing ? "PATCH" : "POST";
			const res = await fetch(url, {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to save");

			setDialogOpen(false);
			await load();
			notify.success(wasEditing ? "Changes saved" : "Automation created");
		} catch (e) {
			notify.error(e);
		} finally {
			setSaving(false);
		}
	}

	function updateReply(i: number, value: string) {
		setForm((f) => {
			const next = [...f.comment_replies];
			next[i] = value;
			return { ...f, comment_replies: next };
		});
	}

	return (
		<div className="space-y-6">
			<div className="grid-texture -mx-4 -mt-10 flex items-center justify-between px-4 pb-2 pt-10 sm:-mx-6 sm:px-6">
				<h1 className="font-display text-3xl font-semibold tracking-tight">
					Automations
				</h1>
				<Button onClick={openCreate}>+ New automation</Button>
			</div>

			{error && (
				<Card>
					<CardContent className="p-5 text-sm text-destructive">
						{error}
					</CardContent>
				</Card>
			)}

			{loading ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : automations.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center p-10 text-center">
						<Button onClick={openCreate}>+ New automation</Button>
						<p className="mt-4 text-sm text-muted-foreground">
							No automations yet. Create your first keyword rule.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{automations.map((a) => (
						<Card key={a.id} className="glass-hover flex flex-col">
							<CardContent className="flex flex-1 flex-col gap-3 p-5">
								<div className="flex items-start justify-between gap-2">
									<h3 className="min-w-0 truncate font-display font-semibold">
										{a.name}
									</h3>
									<Switch
										checked={a.is_active}
										onCheckedChange={() => toggleActive(a)}
										aria-label="Toggle active"
									/>
								</div>

								<div className="flex flex-wrap items-center gap-1.5">
									<Badge variant={a.is_active ? "success" : "muted"}>
										{a.is_active ? "● Active" : "Paused"}
									</Badge>
									<Badge variant="outline">
										{a.scope === "meta"
											? "All Meta accounts"
											: (a.platform_account?.account_name ?? "Account")}
									</Badge>
								</div>

								<div className="flex flex-wrap gap-1.5">
									{a.keywords.map((k) => (
										<Badge key={k}>{k}</Badge>
									))}
								</div>

								<p className="text-xs text-muted-foreground">
									{a.comment_replies.length} reply variant
									{a.comment_replies.length === 1 ? "" : "s"} ·{" "}
									{a.dm_message ? "DM on" : "no DM"} · {a.match_count} matches
								</p>

								<div className="mt-auto flex items-center gap-2 border-t border-border/60 pt-3">
									<Button
										variant="outline"
										size="sm"
										className="flex-1"
										onClick={() => openEdit(a)}
									>
										Edit
									</Button>
									<Button
										variant="ghost"
										size="sm"
										className="text-destructive"
										onClick={() => remove(a)}
									>
										Delete
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			<Dialog
				open={dialogOpen}
				onClose={() => setDialogOpen(false)}
				className="max-w-2xl"
			>
				<DialogHeader
					title={editing ? "Edit automation" : "New automation"}
					description="Triggers when a comment matches a keyword."
				/>
				<div className="grid grid-cols-1 items-start gap-x-6 gap-y-4 sm:grid-cols-2">
					{/* LEFT — what triggers the automation */}
					<div className="space-y-4">
						<p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
							Trigger
						</p>
						<div className="space-y-1.5">
							<Label htmlFor="name">Name</Label>
							<Input
								id="name"
								value={form.name}
								onChange={(e) => setForm({ ...form, name: e.target.value })}
								placeholder="Free guide giveaway"
							/>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="target">Applies to</Label>
							<Select
								id="target"
								value={form.target}
								onChange={(e) => setForm({ ...form, target: e.target.value })}
							>
								<option value="meta">All Meta accounts</option>
								{accounts.map((acc) => (
									<option key={acc.id} value={acc.id}>
										{acc.account_name} ({acc.platform})
									</option>
								))}
							</Select>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="keywords">Keywords</Label>
							<Input
								id="keywords"
								value={form.keywords}
								onChange={(e) => setForm({ ...form, keywords: e.target.value })}
								placeholder="guide, info, link"
							/>
							<p className="text-xs text-muted-foreground">
								Comma-separated. Any one match triggers the reply.
							</p>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="fuzzy">
								Fuzzy threshold: {form.fuzzy_threshold}
							</Label>
							<input
								id="fuzzy"
								type="range"
								min={0}
								max={5}
								value={form.fuzzy_threshold}
								onChange={(e) =>
									setForm({ ...form, fuzzy_threshold: Number(e.target.value) })
								}
								className="w-full accent-[var(--primary)]"
							/>
							<p className="text-xs text-muted-foreground">
								Max typo distance. 0 = exact match only.
							</p>
						</div>
					</div>

					{/* RIGHT — how it responds */}
					<div className="space-y-4">
						<p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
							Response
						</p>
						<div className="space-y-1.5">
							<Label>Public comment replies</Label>
							{form.comment_replies.map((reply, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: stable list of editable rows
								<div key={i} className="flex gap-2">
									<Input
										value={reply}
										onChange={(e) => updateReply(i, e.target.value)}
										placeholder="Just sent it your way!"
									/>
									{form.comment_replies.length > 1 && (
										<Button
											variant="ghost"
											size="icon"
											onClick={() =>
												setForm((f) => ({
													...f,
													comment_replies: f.comment_replies.filter(
														(_, idx) => idx !== i,
													),
												}))
											}
										>
											✕
										</Button>
									)}
								</div>
							))}
							<Button
								variant="outline"
								size="sm"
								onClick={() =>
									setForm((f) => ({
										...f,
										comment_replies: [...f.comment_replies, ""],
									}))
								}
							>
								+ Add variant
							</Button>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="dm">DM message</Label>
							<Textarea
								id="dm"
								value={form.dm_message}
								onChange={(e) =>
									setForm({ ...form, dm_message: e.target.value })
								}
								placeholder="Here's the link you asked for 👇"
							/>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="dmlink">DM link (optional)</Label>
							<Input
								id="dmlink"
								value={form.dm_link}
								onChange={(e) => setForm({ ...form, dm_link: e.target.value })}
								placeholder="https://yoursite.com/free-guide"
							/>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => setDialogOpen(false)}>
						Cancel
					</Button>
					<Button onClick={save} disabled={saving}>
						{saving ? "Saving…" : editing ? "Save changes" : "Create"}
					</Button>
				</DialogFooter>
			</Dialog>
		</div>
	);
}
