/**
 * Static metadata for the guided `/setup` wizard.
 *
 * Keeps `src/app/setup/page.tsx` lean: step ids, titles, the external links the
 * operator visits in the Meta dashboard, deep-link builders (from the saved app
 * id), and the copyable permission lists (imported from the single OAuth source).
 *
 * The wizard is grouped by login type: a required **Instagram** section
 * (Instagram API with Instagram login) and an **optional Facebook Page**
 * section. An Instagram-only operator can skip the entire Facebook group.
 *
 * Browser-safe — imports only `./oauth/scopes` (no `db`/server code).
 */
import { INSTAGRAM_LOGIN_SCOPES, META_SCOPES } from "@/lib/oauth/scopes";
import type { SettingsProvider } from "@/lib/settings";

export const SETUP_STEP_IDS = [
	"prerequisites",
	"create-app",
	// Instagram (required)
	"ig-app-id",
	"ig-app-secret",
	"ig-redirect-uri",
	"ig-webhooks",
	// Facebook Page (optional)
	"fb-app-id",
	"fb-app-secret",
	"fb-redirect-uri",
	"fb-config-id",
	"fb-webhooks",
	// Pre-connect (dev mode)
	"ig-tester",
	// Go live (required for comment webhooks to fire)
	"legal-urls",
	"publish-app",
	// Connect
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
	/**
	 * Optional steps belong to the Facebook Page group. They never block the
	 * wizard's Next button so an Instagram-only operator can skip past them.
	 */
	optional?: boolean;
}

export const SETUP_STEPS: readonly SetupStepMeta[] = [
	{
		id: "prerequisites",
		title: "Prerequisites",
		summary: "An Instagram professional account (Facebook Page optional).",
		completion: { kind: "self" },
	},
	{
		id: "create-app",
		title: "Create your Meta app",
		summary: "A Business-type app in the Meta developer dashboard.",
		completion: { kind: "self" },
	},
	// ── Instagram (required) ────────────────────────────────────────────
	{
		id: "ig-app-id",
		title: "Instagram App ID",
		summary: "From the app's API setup with Instagram login tab.",
		completion: { kind: "settings", provider: "instagram_app_id" },
	},
	{
		id: "ig-app-secret",
		title: "Instagram App Secret",
		summary: "From the app's API setup with Instagram login tab.",
		completion: { kind: "settings", provider: "instagram_app_secret" },
	},
	{
		id: "ig-redirect-uri",
		title: "Instagram Redirect URI",
		summary: "OAuth redirect URI registered under Instagram login settings.",
		completion: { kind: "self" },
	},
	{
		id: "ig-webhooks",
		title: "Instagram Webhooks",
		summary: "Subscribe the Instagram object to comment events.",
		completion: { kind: "self" },
	},
	// ── Facebook Page (optional) ────────────────────────────────────────
	{
		id: "fb-app-id",
		title: "Meta App ID (Facebook)",
		summary: "Optional — only to connect Facebook Pages.",
		completion: { kind: "settings", provider: "meta_app_id" },
		optional: true,
	},
	{
		id: "fb-app-secret",
		title: "Meta App Secret (Facebook)",
		summary: "Optional — Facebook Login for Business + webhook signing.",
		completion: { kind: "settings", provider: "meta_app_secret" },
		optional: true,
	},
	{
		id: "fb-redirect-uri",
		title: "Facebook Redirect URI & App Domain",
		summary: "Optional — redirect URI and app domain for Facebook login.",
		completion: { kind: "self" },
		optional: true,
	},
	{
		id: "fb-config-id",
		title: "Meta Config ID (Facebook)",
		summary: "Optional — a Facebook Login for Business configuration.",
		completion: { kind: "settings", provider: "meta_config_id" },
		optional: true,
	},
	{
		id: "fb-webhooks",
		title: "Facebook Webhooks",
		summary: "Optional — subscribe the Page object to the feed field.",
		completion: { kind: "self" },
		optional: true,
	},
	// ── Pre-connect (dev mode) ──────────────────────────────────────────
	{
		id: "ig-tester",
		title: "Add Instagram tester",
		summary:
			"Add your Instagram account as a tester so the app can connect it.",
		completion: { kind: "self" },
	},
	// ── Go live (required for comment webhooks to fire) ─────────────────
	{
		id: "legal-urls",
		title: "Add your legal URLs",
		summary:
			"Paste your privacy, terms, and data-deletion URLs into App Settings → Basic.",
		completion: { kind: "self" },
	},
	{
		id: "publish-app",
		title: "Publish your app (go Live)",
		summary:
			"Switch the app to Live so Meta delivers comment webhooks in production.",
		completion: { kind: "self" },
	},
	// ── Connect ─────────────────────────────────────────────────────────
	{
		id: "connect",
		title: "Connect accounts",
		summary: "At least one Instagram or Facebook account connected.",
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
	instagramLoginDocs:
		"https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login",
	loginForBusinessDocs:
		"https://developers.facebook.com/docs/facebook-login/facebook-login-for-business",
} as const;

// ============================================================
// Deep links into a specific app (need the saved App ID).
// ============================================================

const APP_BASE = "https://developers.facebook.com/apps";

/** App Settings → Basic (App ID, App Secret, App Domains, legal URLs). */
export function appBasicSettingsUrl(appId: string): string {
	return `${APP_BASE}/${appId}/settings/basic/`;
}

/** App dashboard home — where the Development/Live publish toggle lives. */
export function appDashboardUrl(appId: string): string {
	return `${APP_BASE}/${appId}/`;
}

/** Webhooks product page (Facebook / Page object). */
export function appWebhooksUrl(appId: string): string {
	return `${APP_BASE}/${appId}/webhooks/`;
}

/**
 * “API setup with Instagram login” — the Manage messaging & content on Instagram
 * use-case setup tab. Holds the Instagram app id/secret, business-login redirect
 * URIs, and the Instagram webhooks config. Direct shortcut to the same tab the
 * operator reaches via Use cases → Manage messaging & content on Instagram.
 */
export function appInstagramSetupUrl(appId: string): string {
	return `${APP_BASE}/${appId}/instagram-business/API-Setup/`;
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
// Permission checklists shown on the wizard.
// ============================================================

/** Instagram-login scopes granted automatically during connect. */
export const INSTAGRAM_PERMISSION_LIST: readonly string[] =
	INSTAGRAM_LOGIN_SCOPES;

/** The permissions to confirm are selected on the Login-for-Business config. */
export const PERMISSION_LIST: readonly string[] = META_SCOPES;
