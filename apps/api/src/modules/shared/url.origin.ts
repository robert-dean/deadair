import type { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * An address as the origin a browser sends: `https://radio.example.com/console/` as
 * `https://radio.example.com`. `undefined` for a blank value or one that does not parse.
 *
 * Not `config.rows.ts`'s `originOf`, which answers a comparison KEY for a credential check and keeps
 * an unparseable address as its own text. This one is for a place that is matched against a real
 * `Origin` header, where anything but an origin matches nothing.
 */
export function urlOrigin(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;

    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    try {
        const origin = new URL(trimmed).origin;
        return origin === 'null' ? undefined : origin;
    } catch {
        return undefined;
    }
}

/**
 * The origins a credentialed browser call may come from: the console's (`SPA_BASE_URL`) and the
 * station's own (`APP_BASE_URL`), each once, blanks dropped.
 *
 * As origins rather than as written, because the CORS check compares the browser's `Origin` header
 * EXACTLY: a base URL written with a trailing slash or a path (`https://radio.example.com/`) matched
 * no request at all, and a console on another origin than the API was refused every call.
 */
export function consoleOrigins(config: AppConfig): string[] {
    const origins = (['SPA_BASE_URL', 'APP_BASE_URL'] as const).map(key => urlOrigin(config.get<string, string>(key, '')));
    return [...new Set(origins.filter((origin): origin is string => origin !== undefined))];
}
