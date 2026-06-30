import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Terms of Service",
	description: "Terms governing use of Oh Daddy.",
	robots: { index: true, follow: true },
};

const EFFECTIVE_DATE = "30 June 2026";
const CONTACT_EMAIL = "support@oh-daddy.app";

export default function TermsOfServicePage() {
	return (
		<>
			<h1 className="font-display text-3xl font-semibold tracking-tight">
				Terms of Service
			</h1>
			<p>Effective date: {EFFECTIVE_DATE}</p>

			<p>
				These terms govern use of Oh Daddy (&ldquo;the app&rdquo;). The app is a
				private, single-operator tool that connects Meta accounts (Facebook
				Pages and Instagram professional accounts) and automates comment replies
				and direct messages. By using the app you agree to these terms.
			</p>

			<h2>Use of the app</h2>
			<ul>
				<li>
					The app is operated privately for use with the operator&rsquo;s own
					connected Meta accounts and is not a public service.
				</li>
				<li>
					You may connect only accounts you own or are authorized to manage.
				</li>
				<li>
					You agree to use the app in compliance with Meta&rsquo;s Platform
					Terms and the applicable Facebook and Instagram policies.
				</li>
			</ul>

			<h2>Automated messaging</h2>
			<p>
				The app sends automated public replies and direct messages on the
				operator&rsquo;s behalf in response to comments. The operator is
				responsible for the content of the keywords, replies, and messages they
				configure, and for ensuring that content is lawful and not misleading,
				abusive, or spam.
			</p>

			<h2>Acceptable use</h2>
			<ul>
				<li>
					Do not use the app to send unsolicited bulk or deceptive messages.
				</li>
				<li>Do not use the app to harass, mislead, or harm others.</li>
				<li>
					Do not attempt to circumvent Meta&rsquo;s rate limits or policies.
				</li>
			</ul>

			<h2>No warranty</h2>
			<p>
				The app is provided &ldquo;as is&rdquo;, without warranties of any kind.
				It depends on third-party APIs (Meta) that may change or become
				unavailable. We do not guarantee uninterrupted or error-free operation.
			</p>

			<h2>Limitation of liability</h2>
			<p>
				To the maximum extent permitted by law, the operator and the app are not
				liable for any indirect, incidental, or consequential damages arising
				from use of the app.
			</p>

			<h2>Changes</h2>
			<p>
				We may update these terms from time to time. The effective date above
				reflects the latest version.
			</p>

			<h2>Contact</h2>
			<p>
				Questions about these terms can be sent to{" "}
				<a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
			</p>
		</>
	);
}
