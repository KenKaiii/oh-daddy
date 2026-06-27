"use client";

import { useCallback, useEffect, useState } from "react";

export type OAuthMessage = {
	type: "OAUTH_SUCCESS" | "OAUTH_ERROR";
	platform?: string;
	accountId?: string;
	error?: string;
	discoveredAccounts?: Array<{
		platform: string;
		account_id: string;
		account_name: string;
	}>;
};

interface UseOAuthPopupOptions {
	onSuccess?: (data: OAuthMessage) => void;
	onError?: (error: string) => void;
}

export function useOAuthPopup(options: UseOAuthPopupOptions = {}) {
	const { onSuccess, onError } = options;
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleMessage = useCallback(
		(event: MessageEvent<OAuthMessage>) => {
			if (event.origin !== window.location.origin) return;
			if (!event.data?.type?.startsWith("OAUTH_")) return;

			setIsLoading(false);
			if (event.data.type === "OAUTH_SUCCESS") {
				setError(null);
				onSuccess?.(event.data);
			} else {
				const msg = event.data.error ?? "Authentication failed";
				setError(msg);
				onError?.(msg);
			}
		},
		[onSuccess, onError],
	);

	useEffect(() => {
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [handleMessage]);

	const openOAuthTab = useCallback(
		async (platform: "facebook" | "instagram", accountId: string) => {
			setIsLoading(true);
			setError(null);
			try {
				const response = await fetch("/api/oauth/authorize", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ platform, accountId }),
				});
				if (!response.ok) {
					const data = await response.json();
					throw new Error(data.error ?? "Failed to start OAuth flow");
				}
				const { authorizationUrl } = await response.json();
				window.open(authorizationUrl, "_blank");
			} catch (err) {
				setIsLoading(false);
				const msg =
					err instanceof Error ? err.message : "Failed to open authentication";
				setError(msg);
				onError?.(msg);
			}
		},
		[onError],
	);

	return { openOAuthTab, isLoading, error };
}
