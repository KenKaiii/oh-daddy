import { cn } from "@/lib/utils";

type Platform = "instagram" | "facebook" | string;

/**
 * Full-bleed brand logos. The SVG *is* the icon (gradient square / blue
 * circle), so there's no separate tile creating a "square within a square".
 */
function InstagramLogo({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			className={className}
			role="img"
			aria-label="Instagram"
		>
			<defs>
				<linearGradient id="ig-grad" x1="0" y1="1" x2="1" y2="0">
					<stop offset="0" stopColor="#feda75" />
					<stop offset="0.25" stopColor="#fa7e1e" />
					<stop offset="0.5" stopColor="#d62976" />
					<stop offset="0.75" stopColor="#962fbf" />
					<stop offset="1" stopColor="#4f5bd5" />
				</linearGradient>
			</defs>
			<rect width="24" height="24" rx="6.5" fill="url(#ig-grad)" />
			<rect
				x="5.25"
				y="5.25"
				width="13.5"
				height="13.5"
				rx="4.25"
				fill="none"
				stroke="#fff"
				strokeWidth="1.7"
			/>
			<circle
				cx="12"
				cy="12"
				r="3.4"
				fill="none"
				stroke="#fff"
				strokeWidth="1.7"
			/>
			<circle cx="16.4" cy="7.6" r="1.15" fill="#fff" />
		</svg>
	);
}

function FacebookLogo({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			className={className}
			role="img"
			aria-label="Facebook"
		>
			<circle cx="12" cy="12" r="12" fill="#1877f2" />
			<path
				fill="#fff"
				d="M16.06 15.47l.53-3.47h-3.33V9.75c0-.95.47-1.88 1.96-1.88h1.51V4.92s-1.37-.24-2.69-.24c-2.74 0-4.53 1.66-4.53 4.67V12H6.61v3.47h3.05v8.39a12.1 12.1 0 0 0 3.6 0v-8.39h2.8z"
			/>
		</svg>
	);
}

export function PlatformIcon({
	platform,
	className,
}: {
	platform: Platform;
	className?: string;
}) {
	const Logo = platform === "instagram" ? InstagramLogo : FacebookLogo;
	return <Logo className={cn("h-10 w-10 shrink-0", className)} />;
}
