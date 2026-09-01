// Whether a page that is not the console may read the stream, which is the whole of this
// middleware. Get it wrong in one direction and every JavaScript player is refused while native
// playback keeps working, so the station looks fine from a browser address bar and broken from
// anything embedding it. Get it wrong in the other and the console's own credentialed origin
// starts failing, because `*` and `Access-Control-Allow-Credentials` on one response is rejected
// by the browser outright.

import { describe, expect, it } from 'vitest';

import { hlsCorsMiddleware } from '../../../src/server/middleware/hls.cors.middleware.js';

/**
 * A request as Koa presents it, with just the header bag this middleware touches.
 *
 * `set` and `remove` are the real ones' semantics: last write wins, and a removed header is
 * gone rather than empty.
 */
const contextFor = (path: string) => {
    const headers: Record<string, string> = {};

    return {
        headers,
        ctx: {
            path,
            set: (key: string, value: string) => {
                headers[key] = value;
            },
            remove: (key: string) => {
                delete headers[key];
            },
        },
    };
};

/** What the global CORS middleware does for an origin it recognises, deeper in the onion. */
const globalCorsAllows = (ctx: { set: (key: string, value: string) => void }, origin: string) => async () => {
    ctx.set('Access-Control-Allow-Origin', origin);
    ctx.set('Access-Control-Allow-Credentials', 'true');
};

/** What it does for one it does not: names the header it varied on and allows nothing. */
const globalCorsRefuses = (ctx: { set: (key: string, value: string) => void }) => async () => {
    ctx.set('Vary', 'Origin');
};

describe('hlsCorsMiddleware', () => {
    it('opens a playlist to any origin', async () => {
        const { ctx, headers } = contextFor('/hls/live.m3u8');

        await hlsCorsMiddleware()(ctx as never, globalCorsRefuses(ctx));

        expect(headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('overrides the global answer rather than losing to it', async () => {
        // The console's own origin, which the global middleware allows by name. The wildcard has
        // to win: this runs on the way out, and a version that wrote before `next` would be
        // overwritten here and nowhere else, which is the bug with the narrowest symptom.
        const { ctx, headers } = contextFor('/hls/aac.m3u8');

        await hlsCorsMiddleware()(ctx as never, globalCorsAllows(ctx, 'https://radio.example'));

        expect(headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('strips the credentials header, which a browser refuses beside a wildcard', async () => {
        const { ctx, headers } = contextFor('/hls/aac.m3u8');

        await hlsCorsMiddleware()(ctx as never, globalCorsAllows(ctx, 'https://radio.example'));

        expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
    });

    it('leaves everything else to the credentialed allowlist', async () => {
        // The console carries the refresh cookie cross-origin and needs the named origin and the
        // credentials header both. Widening this middleware past the HLS prefix would take them
        // away, so the prefix is the whole guard and is worth a test of its own.
        const { ctx, headers } = contextFor('/me/sessions');

        await hlsCorsMiddleware()(ctx as never, globalCorsAllows(ctx, 'https://radio.example'));

        expect(headers['Access-Control-Allow-Origin']).toBe('https://radio.example');
        expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    });

    it('does not claim a path that merely starts with the letters', async () => {
        // The same reasoning as the heartbeat prefix: the trailing slash is what makes this a
        // path SEGMENT, so a future `/hlsx` route keeps the ordinary policy.
        const { ctx, headers } = contextFor('/hlsx/live.m3u8');

        await hlsCorsMiddleware()(ctx as never, globalCorsRefuses(ctx));

        expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    });
});
