"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Read the post-login redirect target, restricted to same-origin paths. */
function safeNextPath(): string {
	if (typeof window === "undefined") return "/";
	const raw = new URLSearchParams(window.location.search).get("next");
	// Only allow absolute, single-slash paths to avoid open-redirects.
	if (raw?.startsWith("/") && !raw.startsWith("//")) return raw;
	return "/";
}

export default function LoginPage() {
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			const res = await fetch("/api/auth/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password }),
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json.error ?? "Login failed");
			window.location.href = safeNextPath();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Login failed");
			setSubmitting(false);
		}
	}

	return (
		<div className="flex min-h-dvh items-center justify-center py-12">
			<Card className="glass-hover w-full max-w-sm">
				<CardHeader>
					<CardTitle>Oh yeah daddy</CardTitle>
				</CardHeader>
				<CardContent>
					<form onSubmit={submit} className="space-y-4">
						<div className="flex flex-col gap-2.5">
							<Label htmlFor="password">Admin password</Label>
							<Input
								id="password"
								type="password"
								autoComplete="current-password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="••••••••"
								autoFocus
							/>
						</div>
						{error && <p className="text-sm text-destructive">{error}</p>}
						<Button type="submit" disabled={submitting} className="w-full">
							{submitting ? "Signing in…" : "Oh yeah daddy"}
						</Button>
						<p className="text-xs text-muted-foreground">
							Authenticated personnel only.
						</p>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
