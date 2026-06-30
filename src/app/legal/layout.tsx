import type { ReactNode } from "react";

/**
 * Public, unauthenticated wrapper for the legal pages (privacy, terms, data
 * deletion). These URLs are crawled by Meta's App Review, so they must render
 * for anonymous visitors — no nav, no auth. The root layout already renders
 * page content for everyone; this just gives the legal docs readable prose.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
	return (
		<article className="mx-auto max-w-2xl space-y-5 py-12 text-sm leading-relaxed text-foreground [&_a]:underline [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_p]:text-muted-foreground [&_li]:text-muted-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
			{children}
		</article>
	);
}
