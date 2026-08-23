// The regression here is not the flag on the cookie, it is the THROW. A cookie jar refuses a
// `secure` cookie on a connection it believes is plain, and both places this cookie is written
// are error paths — clearing a dead token after a 401. So getting the scheme wrong turned every
// expired session into a 500 that also failed to clear the cookie, which the browser then
// presented again on the next boot.

import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Context } from 'koa';

import { REFRESH_COOKIE_NAME, clearRefreshCookie, setRefreshCookie } from '../../../src/modules/authentication/refresh.cookie.js';
import { TRUST_PROXY_KEY } from '../../../src/modules/shared/request.trust.js';

/** Strings, because every `AppConfig` layer holds text — see `setting.flags.ts`. */
const configWith = (trustProxy: string | undefined): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key === TRUST_PROXY_KEY && trustProxy !== undefined ? trustProxy : fallback) }) as AppConfig;

type Written = { name: string; value: string | null; secure?: boolean };

/**
 * A cookie jar with the one behaviour that matters: it refuses a `secure` cookie unless its own
 * `secure` says the connection was encrypted. That is the rule the real jar enforces and the rule
 * the old `NODE_ENV` check walked into.
 */
const jar = (secure: boolean) => {
    const written: Written[] = [];

    return {
        written,
        cookies: {
            secure,
            set(name: string, value: string | null, opts: { secure?: boolean }) {
                if (opts.secure && !this.secure) throw new Error('Cannot send secure cookie over unencrypted connection');
                written.push({ name, value, secure: opts.secure });
            },
        },
    };
};

const contextOf = (options: { secure?: boolean; headers?: Record<string, string>; trustProxy?: string }) => {
    const built = jar(options.secure ?? false);
    const ctx = {
        secure: options.secure ?? false,
        req: { headers: options.headers ?? {} },
        cookies: built.cookies,
        container: { get: () => configWith(options.trustProxy) },
    };

    return { ctx: ctx as unknown as Context, written: built.written };
};

describe('the refresh cookie', () => {
    it('is written, unmarked, over the plain HTTP the bundled edge serves', () => {
        // Production is one container behind an nginx on port 80. Marking the cookie `secure`
        // there is not a stricter cookie, it is no cookie and a 500.
        const { ctx, written } = contextOf({ headers: { 'x-forwarded-proto': 'http' }, trustProxy: 'true' });

        expect(() => setRefreshCookie(ctx, 'rt-1')).not.toThrow();
        expect(written).toEqual([{ name: REFRESH_COOKIE_NAME, value: 'rt-1', secure: false }]);
    });

    it('is marked secure behind a trusted edge that terminated TLS', () => {
        // The inside hop is plain, so Koa's own answer is false and the jar would veto. The
        // forwarded scheme is the browser's, which is the one the flag is about.
        const { ctx, written } = contextOf({ headers: { 'x-forwarded-proto': 'https' }, trustProxy: 'true' });

        setRefreshCookie(ctx, 'rt-2');

        expect(written).toEqual([{ name: REFRESH_COOKIE_NAME, value: 'rt-2', secure: true }]);
    });

    it('is marked secure when the app terminated TLS itself, with nothing to trust', () => {
        const { ctx, written } = contextOf({ secure: true });

        setRefreshCookie(ctx, 'rt-3');

        expect(written[0]?.secure).toBe(true);
    });

    it('does not believe a forwarded scheme while TRUST_PROXY is off, including as the STRING "false"', () => {
        // A header is a claim. Believing it unasked would mark the cookie secure on a station
        // reachable around its proxy, and the browser would then never send it back.
        const { ctx, written } = contextOf({ headers: { 'x-forwarded-proto': 'https' }, trustProxy: 'false' });

        setRefreshCookie(ctx, 'rt-4');

        expect(written[0]?.secure).toBe(false);
    });

    it('clears with the same attributes it set, so the browser matches the cookie it holds', () => {
        const { ctx, written } = contextOf({ headers: { 'x-forwarded-proto': 'https' }, trustProxy: 'true' });

        clearRefreshCookie(ctx);

        expect(written).toEqual([{ name: REFRESH_COOKIE_NAME, value: null, secure: true }]);
    });
});
