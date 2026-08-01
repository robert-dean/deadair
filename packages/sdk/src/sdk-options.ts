export class SdkError extends Error {
    constructor(
        public readonly status: number,
        public readonly statusText: string,
        public readonly body: unknown,
        public readonly headers: Headers,
    ) {
        super(`${status} ${statusText}`);
        this.name = 'SdkError';
    }
}

export type SdkFetch = (url: string, init: RequestInit) => Promise<Response>;

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

export function createSdkFetch(options: SdkOptions): SdkFetch {
    const getRequestId = options.requestIdFactory ?? (() => crypto.randomUUID());
    return async (url: string, init: RequestInit): Promise<Response> => {
        const baseHeaders = typeof options.headers === 'function' ? await options.headers() : (options.headers ?? {});
        const res = await fetch(`${options.baseUrl}${url}`, {
            ...init,
            headers: { ...baseHeaders, 'X-Request-ID': getRequestId(), ...(init.headers as Record<string, string>) },
        });
        if (!res.ok) {
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

export async function parseJson<T>(res: Response): Promise<T> {
    return JSON.parse(await res.text(), bigIntReviver) as T;
}
