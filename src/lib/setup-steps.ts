/**
 * Static metadata for the guided `/setup` wizard.
 *
 * Keeps `src/app/setup/page.tsx` lean: step ids, titles, the external links the
 * operator visits in the Meta dashboard, deep-link builders (from the saved app
 * id), and the copyable permission list (imported from the single OAuth source).
 *
 * Browser-safe — imports only `./oauth/scopes` (no `db`/server code).
 */
import { META_SCOPES } from "@/lib/oauth/scopes";
import type { SettingsProvider } from "@/lib/settings";

export const SETUP_STEP_IDS = [
	"prerequisites",
	"create-app",
	"app-id",
	"app-secret",
	"redirect-uri",
	"config-id",
	"webhooks",
	"connect",
] as const;

export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

/**
 * How a step's "done" state is determined:
 * - `settings`  — server-known: the provider's `is_set` from `/api/settings`.
 * - `accounts`  — server-known: at least one connected account.
 * - `self`      — external Meta state we can't read; the operator marks it done
 *                 and we persist the choice in `localStorage`.
 */
export type SetupCompletion =
	| { kind: "settings"; provider: SettingsProvider }
	| { kind: "accounts" }
	| { kind: "self" };

export interface SetupStepMeta {
	id: SetupStepId;
	/** Step heading. */
	title: string;
	/** One-line summary shown when the step is collapsed/done. */
	summary: string;
	completion: SetupCompletion;
}

export const SETUP_STEPS: readonly SetupStepMeta[] = [
	{
		id: "prerequisites",
		title: "Prerequisites",
		summary: "Facebook account, Page, IG Business account, Business portfolio.",
		completion: { kind: "self" },
	},
	{
		id: "create-app",
		title: "Create your Meta app",
		summary: "A Business-type app in the Meta developer dashboard.",
		completion: { kind: "self" },
	},
	{
		id: "app-id",
		title: "Meta App ID",
		summary: "Saved from App Settings → Basic.",
		completion: { kind: "settings", provider: "meta_app_id" },
	},
	{
		id: "app-secret",
		title: "Meta App Secret",
		summary: "Saved from App Settings → Basic.",
		completion: { kind: "settings", provider: "meta_app_secret" },
	},
	{
		id: "redirect-uri",
		title: "OAuth Redirect URI & App Domains",
		summary: "Redirect URI and app domain registered in Meta.",
		completion: { kind: "self" },
	},
	{
		id: "config-id",
		title: "Meta Config ID",
		summary: "Saved from a Facebook Login for Business configuration.",
		completion: { kind: "settings", provider: "meta_config_id" },
	},
	{
		id: "webhooks",
		title: "Webhooks",
		summary: "Callback URL & verify token registered, fields subscribed.",
		completion: { kind: "self" },
	},
	{
		id: "connect",
		title: "Connect Meta",
		summary: "At least one Page or Instagram account connected.",
		completion: { kind: "accounts" },
	},
] as const;

// ============================================================
// External links (Meta dashboards / help) — open in a new tab.
// ============================================================

export const EXTERNAL_LINKS = {
	facebookSignup: "https://www.facebook.com/",
	createPage: "https://www.facebook.com/pages/creation/",
	instagramBusiness: "https://help.instagram.com/502981923235522", // set up a professional account
	businessPortfolio: "https://business.facebook.com/",
	appsDashboard: "https://developers.facebook.com/apps/",
	loginForBusinessDocs:
		"https://developers.facebook.com/docs/facebook-login/facebook-login-for-business",
} as const;

// ============================================================
// Deep links into a specific app (need the saved App ID).
// ============================================================

const APP_BASE = "https://developers.facebook.com/apps";

/** App Settings → Basic (App ID, App Secret, App Domains). */
export function appBasicSettingsUrl(appId: string): string {
	return `${APP_BASE}/${appId}/settings/basic/`;
}

/** Webhooks product page. */
export function appWebhooksUrl(appId: string): string {
	return `${APP_BASE}/${appId}/webhooks/`;
}

/** Facebook Login for Business → Settings (Valid OAuth Redirect URIs). */
export function appLoginSettingsUrl(appId: string): string {
	return `${APP_BASE}/${appId}/fb-login/settings/`;
}

/** Facebook Login for Business → Configurations (create a Config ID). */
export function appLoginConfigurationsUrl(appId: string): string {
	return `${APP_BASE}/${appId}/fb-login/configurations/`;
}

// ============================================================
// Copyable permission list for the FLB configuration step.
// ============================================================

/** The permissions to enable on the Login-for-Business configuration. */
export const PERMISSION_LIST: readonly string[] = META_SCOPES;

/** Comma-joined permissions, for the copy button. */
export const PERMISSION_LIST_TEXT: string = META_SCOPES.join(",");
