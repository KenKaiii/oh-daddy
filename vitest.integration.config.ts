import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests hit a real Postgres (see src/test/pg.ts). Kept in a
// separate config so the default `npm test` stays hermetic and fast.
export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		include: ["src/**/*.integration.test.ts"],
		// One DB-backed file at a time avoids cross-file CREATE DATABASE races.
		fileParallelism: false,
		hookTimeout: 30_000,
		testTimeout: 15_000,
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
});
