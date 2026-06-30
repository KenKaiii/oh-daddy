"use client";

import { useEffect } from "react";

/**
 * Global UI click sound. Mounted once in the root layout; attaches a single
 * document-level listener so every interactive element (buttons, links, nav
 * items, switches, selects, etc.) gets a click without per-component wiring.
 *
 * Implementation notes:
 *  - One pooled <audio> per concurrent play, reset to 0 so rapid clicks stack
 *    instead of cutting each other off.
 *  - The first audible play is unlocked by the user's own click gesture, so
 *    browser autoplay policies are satisfied.
 *  - Honors prefers-reduced-motion as a proxy for "reduce non-essential
 *    feedback" — users who opt out of motion get no click sound either.
 */

// Elements that should click. `closest()` walks up so clicking an icon inside a
// button still triggers it.
const INTERACTIVE_SELECTOR = [
	"button",
	"a[href]",
	'[role="button"]',
	'[role="switch"]',
	'[role="tab"]',
	'[role="menuitem"]',
	'input[type="checkbox"]',
	'input[type="radio"]',
	'input[type="button"]',
	'input[type="submit"]',
	"select",
	"summary",
	"label.checkbox-label",
].join(",");

export function ClickSound() {
	useEffect(() => {
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
			return;
		}

		// Small pool so overlapping clicks don't truncate one another.
		const POOL_SIZE = 4;
		const pool: HTMLAudioElement[] = [];
		for (let i = 0; i < POOL_SIZE; i++) {
			const a = new Audio("/click.mp3");
			a.volume = 0.35;
			a.preload = "auto";
			pool.push(a);
		}
		let next = 0;

		function play() {
			const a = pool[next];
			next = (next + 1) % POOL_SIZE;
			try {
				a.currentTime = 0;
				void a.play().catch(() => {});
			} catch {}
		}

		function onClick(e: MouseEvent) {
			// Only real, primary-button activations.
			if (e.button !== 0) return;
			const target = e.target as Element | null;
			if (!target?.closest) return;

			const el = target.closest<HTMLElement>(INTERACTIVE_SELECTOR);
			if (!el) return;
			if (el.getAttribute("aria-disabled") === "true") return;
			if ("disabled" in el && (el as HTMLButtonElement).disabled) return;
			// Opt-out hook for anything that shouldn't click.
			if (el.closest("[data-no-click-sound]")) return;

			play();
		}

		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, []);

	return null;
}
