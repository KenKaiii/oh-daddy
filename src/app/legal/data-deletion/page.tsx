import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Data Deletion Instructions",
	description: "How to request deletion of your data from Oh Daddy.",
	robots: { index: true, follow: true },
};

const EFFECTIVE_DATE = "30 June 2026";
const CONTACT_EMAIL = "support@oh-daddy.app";

export default function DataDeletionPage() {
	return (
		<>
			<h1 className="font-display text-3xl font-semibold tracking-tight">
				Data Deletion Instructions
			</h1>
			<p>Effective date: {EFFECTIVE_DATE}</p>

			<p>
				Oh Daddy (&ldquo;the app&rdquo;) is a private, single-operator tool that
				connects Meta accounts and automates comment replies and direct
				messages. This page explains how to have your data removed.
			</p>

			<h2>If you are the operator</h2>
			<p>
				To delete data for a connected account, open the app, go to{" "}
				<strong>Accounts</strong>, and choose <strong>Disconnect</strong> on the
				account. Disconnecting invalidates the stored access token and removes
				the account&rsquo;s associated data (contacts, conversations, and
				messages tied to that account).
			</p>

			<h2>If you commented and want your data removed</h2>
			<p>
				If you interacted with an account connected to this app (for example,
				you commented on a post and received an automated reply or message) and
				you want any stored copy of that interaction deleted, send a request to{" "}
				<a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with:
			</p>
			<ul>
				<li>Your Instagram or Facebook username.</li>
				<li>
					The approximate date of the interaction and the account/post involved,
					if known.
				</li>
				<li>The subject line &ldquo;Data deletion request&rdquo;.</li>
			</ul>
			<p>
				We will delete the requested data within 30 days and confirm by reply.
			</p>

			<h2>What gets deleted</h2>
			<ul>
				<li>Stored contact details (public name, username, and identifier).</li>
				<li>Stored comment and message records for the interaction.</li>
				<li>
					For a disconnected account, its access token and account record.
				</li>
			</ul>

			<h2>Contact</h2>
			<p>
				For any deletion request or question, contact{" "}
				<a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
			</p>
		</>
	);
}
