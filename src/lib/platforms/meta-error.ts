/**
 * Typed error thrown by the Graph API fetch wrapper when Meta returns a
 * non-2xx response. Preserves the structured payload so callers can branch
 * on the numeric `code` instead of regex-matching the message string.
 */
export interface MetaApiErrorBody {
	message: string;
	type?: string;
	code: number;
	error_subcode?: number;
	fbtrace_id?: string;
}

export class MetaApiCallError extends Error {
	readonly status: number;
	readonly code: number;
	readonly subcode: number | null;
	readonly fbtraceId: string | null;
	readonly body: MetaApiErrorBody | null;

	constructor(
		message: string,
		opts: { status: number; body: MetaApiErrorBody | null },
	) {
		super(message);
		this.name = "MetaApiCallError";
		this.status = opts.status;
		this.code = opts.body?.code ?? 0;
		this.subcode = opts.body?.error_subcode ?? null;
		this.fbtraceId = opts.body?.fbtrace_id ?? null;
		this.body = opts.body;
	}
}
