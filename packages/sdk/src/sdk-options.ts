export class SdkError<TBody = unknown> extends Error {
    constructor(
        public readonly status: number,
        public readonly statusText: string,
        public readonly body: TBody,
        public readonly headers: Headers,
    ) {
        super(`${status} ${statusText}`);
        this.name = 'SdkError';
    }
}

export interface SdkRequestInit extends RequestInit {
    /**
     * Statuses this operation declares as values rather than errors — a 304 from
     * conditional-GET middleware, or an error status the service returns deliberately.
     * Anything else at or above 400 still throws SdkError.
     */
    expectStatuses?: number[];
}

export type SdkFetch = (url: string, init: SdkRequestInit) => Promise<Response>;

export interface SdkOptions {
    baseUrl: string;
    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
    fetch?: SdkFetch;
    /** Called once per request to produce a unique X-Request-ID header value */
    requestIdFactory?: () => string;
}

export const bigIntReplacer = (_: string, value: any): any => {
    if (typeof value === 'bigint') {
        return value.toString() + 'n';
    }
    return value;
};

export const bigIntReviver = (_: string, value: any): any => {
    if (typeof value === 'string' && /^-?\d+n$/.test(value)) {
        return BigInt(value.slice(0, -1));
    }
    return value;
};

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function readContentType(res: Response): string {
    return res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
}

/** A v4 UUID. `crypto.randomUUID` exists only in a secure context, so plain HTTP builds one by hand. */
function randomRequestId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createSdkFetch(options: SdkOptions): SdkFetch {
    const getRequestId = options.requestIdFactory ?? randomRequestId;
    return async (url: string, init: SdkRequestInit): Promise<Response> => {
        const baseHeaders = typeof options.headers === 'function' ? await options.headers() : (options.headers ?? {});
        const res = await fetch(`${options.baseUrl}${url}`, {
            ...init,
            headers: { ...baseHeaders, 'X-Request-ID': getRequestId(), ...(init.headers as Record<string, string>) },
        });
        if (!res.ok && !(init.expectStatuses ?? []).includes(res.status)) {
            const text = await res.text();
            let body: unknown;
            try {
                body = JSON.parse(text);
            } catch {
                body = text;
            }
            throw new SdkError(res.status, res.statusText, body, res.headers);
        }
        return res;
    };
}

export function buildQueryString(query: object | undefined): string {
    const searchParams = new URLSearchParams();
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v === undefined || v === null) continue;
            if (Array.isArray(v)) {
                for (const item of v) searchParams.append(k, String(item));
            } else searchParams.set(k, String(v));
        }
    }
    const qs = searchParams.toString();
    return qs ? `?${qs}` : '';
}

export function buildHeaders(headers: object | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (headers) {
        for (const [k, v] of Object.entries(headers)) {
            if (v === undefined || v === null) continue;
            out[k] = Array.isArray(v) ? v.map(String).join(', ') : String(v);
        }
    }
    return out;
}

export function parseBigIntHeader(name: string, value: string): bigint {
    if (/^-?\d+n?$/.test(value)) return BigInt(value.replace(/n$/, ''));
    throw new Error(`Response header '${name}' is not a bigint: ${JSON.stringify(value)}`);
}

/** Per-call options for an operation that streams Server-Sent Events. */
export interface SseRequestOptions {
    /** Aborts the request. An iteration in progress rejects with the abort reason. */
    signal?: AbortSignal;
    /** Resume after this event id, sent as Last-Event-ID. Usually an earlier stream's lastEventId. */
    lastEventId?: string;
}

/**
 * The events of one Server-Sent Events response, parsed as they arrive. Iterate it once with
 * for await; leaving the loop early closes the connection.
 */
export interface SseEventStream<T> extends AsyncIterable<T> {
    /** The id of the most recent event that carried one, to resume from with SseRequestOptions.lastEventId. */
    readonly lastEventId: string | undefined;
}

/** The request headers a streaming call sends: Accept, plus Last-Event-ID when resuming. */
export function sseRequestHeaders(options: SseRequestOptions | undefined): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (options?.lastEventId !== undefined) headers['Last-Event-ID'] = options.lastEventId;
    return headers;
}

/**
 * Parse a text/event-stream response into its events. Data lines are joined with newlines and
 * dispatched on a blank line; comments and other fields are skipped; an event cut off by the end
 * of the stream is dropped. Each event's data goes through parse, JSON.parse by default.
 */
export function parseSse<T>(res: Response, parse: (data: string) => T = data => JSON.parse(data) as T): SseEventStream<T> {
    let lastEventId: string | undefined;
    let iterated = false;
    async function* events(): AsyncGenerator<T> {
        if (!res.body) return;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        let data: string[] = [];
        try {
            for (;;) {
                const chunk = await reader.read();
                if (!chunk.done) buffer += chunk.value;
                for (;;) {
                    const end = buffer.search(/\r\n|\r|\n/);
                    // A trailing CR may be the first half of a CRLF split across two reads, unless
                    // this was the last read.
                    if (end === -1 || (!chunk.done && end === buffer.length - 1 && buffer[end] === '\r')) break;
                    const line = buffer.slice(0, end);
                    buffer = buffer.slice(buffer.startsWith('\r\n', end) ? end + 2 : end + 1);
                    if (line === '') {
                        if (data.length > 0) yield parse(data.join('\n'));
                        data = [];
                        continue;
                    }
                    const colon = line.indexOf(':');
                    const field = colon === -1 ? line : line.slice(0, colon);
                    const value = colon === -1 ? '' : line.slice(line.startsWith(' ', colon + 1) ? colon + 2 : colon + 1);
                    if (field === 'data') data.push(value);
                    else if (field === 'id' && !value.includes('\0')) lastEventId = value;
                }
                if (chunk.done) return;
            }
        } finally {
            await reader.cancel().catch(() => undefined);
        }
    }
    return {
        get lastEventId() {
            return lastEventId;
        },
        [Symbol.asyncIterator]() {
            if (iterated) throw new Error('An SseEventStream can be iterated only once');
            iterated = true;
            return events();
        },
    };
}

/**
 * Read a JSON response body.
 *
 * No reviver: `bigIntReviver` matches any string of the form `123n` anywhere in the
 * document, so a contract with no bigint field would still have a legitimate string like
 * "123n" silently turned into a BigInt. Clients whose contracts do use bigint import
 * `parseJsonWithBigInt` under this name instead.
 */
export async function parseJson<T>(res: Response): Promise<T> {
    return JSON.parse(await res.text()) as T;
}

/** `parseJson` for contracts that declare a bigint, applying the `123n` reviver. */
export async function parseJsonWithBigInt<T>(res: Response): Promise<T> {
    return JSON.parse(await res.text(), bigIntReviver) as T;
}
