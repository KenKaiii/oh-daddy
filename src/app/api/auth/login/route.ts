import { cookies } from "next/headers";
import { z } from "zod";

import {
	getAuthSecret,
	SESSION_COOKIE,
	SESSION_MAX_AGE_SECONDS,
	sessionTokenFor,
	timingSafeEqualStr,
} from "@/lib/auth";

const loginSchema = z.object({ password: z.string().min(1) });

// POST — exchange the shared secret for an httpOnly session cookie.
// Exempt from the proxy gate (this is how a browser obtains the session).
export async function POST(request: Request) {
	const secret = getAuthSecret();
	if (!secret) {
		return Response.json(
			{
				error:
					"Server auth is not configured. Set DASHBOARD_PASSWORD in the environment.",
			},
			{ status: 503 },
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const parsed = loginSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: "Password is required" }, { status: 400 });
	}

	if (!timingSafeEqualStr(parsed.data.password, secret)) {
		return Response.json({ error: "Invalid password" }, { status: 401 });
	}

	const cookieStore = await cookies();
	cookieStore.set(SESSION_COOKIE, sessionTokenFor(secret), {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: SESSION_MAX_AGE_SECONDS,
	});

	return Response.json({ success: true });
}

// DELETE — clear the session cookie (logout).
export async function DELETE() {
	const cookieStore = await cookies();
	cookieStore.delete(SESSION_COOKIE);
	return Response.json({ success: true });
}
