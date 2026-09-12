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
