/**
 * Name of the HttpOnly cookie that binds an OAuth flow to the browser session
 * that initiated it. Set in /api/oauth/authorize, verified (and cleared) in
 * /api/oauth/callback so a callback can only be completed by the same browser
 * that started the flow.
 */
export const OAUTH_STATE_COOKIE = "oauth_state";
