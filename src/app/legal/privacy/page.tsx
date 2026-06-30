import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Privacy Policy",
	description: "How Oh Daddy collects, uses, and protects data.",
	robots: { index: true, follow: true },
};

const EFFECTIVE_DATE = "30 June 2026";
const CONTACT_EMAIL = "support@oh-daddy.app";

export default function PrivacyPolicyPage() {
	return (
		<>
			<h1 className="font-display text-3xl font-semibold tracking-tight">
				Privacy Policy
			</h1>
			<p>Effective date: {EFFECTIVE_DATE}</p>

			<p>
				Oh Daddy (&ldquo;the app&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is
				a private, single-operator tool that connects Meta accounts (Facebook
				Pages and Instagram professional accounts) and automatically replies to
				comments and sends direct messages based on keyword rules the operator
				configures. This policy explains what data the app handles and how.
			</p>

			<h2>Who operates this app</h2>
			<p>
				The app is operated privately by its sole operator for use with their
				own connected Meta accounts. It is not offered as a public service.
				Questions can be sent to{" "}
				<a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
			</p>

			<h2>Information we process</h2>
			<ul>
				<li>
					<strong>Connected account data:</strong> the access tokens and account
					identifiers for the Meta accounts the operator chooses to connect.
					Tokens are encrypted at rest.
				</li>
				<li>
					<strong>Public engagement data:</strong> when someone comments on a
					connected account&rsquo;s post, we process the comment text, the
					comment and post identifiers, and the commenter&rsquo;s public
					name/username and id in order to evaluate keyword rules.
				</li>
				<li>
					<strong>Messages we send:</strong> the public replies and direct
					messages the app sends on the operator&rsquo;s behalf, stored for the
					operator&rsquo;s records.
				</li>
			</ul>

			<h2>How we use it</h2>
			<ul>
				<li>
					To match incoming comments against the operator&rsquo;s keywords.
				</li>
				<li>
					To post an automated public reply and/or a private reply (direct
					message) to the person who commented.
				</li>
				<li>
					To prevent duplicate sends and respect a per-person cooldown window.
				</li>
			</ul>

			<h2>What we do not do</h2>
			<ul>
				<li>We do not sell or share personal data with third parties.</li>
				<li>We do not use the data for advertising or profiling.</li>
				<li>
					We only access data through Meta&rsquo;s official APIs and only for
					the connected accounts.
				</li>
			</ul>

			<h2>Data retention &amp; deletion</h2>
			<p>
				Data is retained only while an account is connected. Disconnecting an
				account, or following the steps in our{" "}
				<a href="/legal/data-deletion">Data Deletion instructions</a>, removes
				the associated stored data. Tokens are invalidated when an account is
				disconnected.
			</p>

			<h2>Security</h2>
			<p>
				Access tokens and secrets are encrypted at rest (AES-256-GCM) and the
				application is gated behind operator authentication. Data is transmitted
				over HTTPS.
			</p>

			<h2>Changes</h2>
			<p>
				We may update this policy from time to time. The effective date above
				reflects the latest version.
			</p>

			<h2>Contact</h2>
			<p>
				For privacy questions or requests, contact{" "}
				<a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
			</p>
		</>
	);
}
