// Whether a page that is not the console may read what is on air. Wrong in one direction and the
// community directory, and any listener's widget, is refused while the console keeps working; wrong
// in the other and the console's own credentialed origin fails, because `*` beside
// `Access-Control-Allow-Credentials` is rejected by the browser outright.

import { describe, expect, it } from 'vitest';

import { nowPlayingCorsMiddleware } from '../../../src/server/middleware/nowplaying.cors.middleware.js';

/** A request as Koa presents it, with just the header bag this middleware touches. Last write wins; a removed header is gone. */
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

describe('nowPlayingCorsMiddleware', () => {
    it('opens what is on air to any origin', async () => {
        const { ctx, headers } = contextFor('/nowplaying');

        await nowPlayingCorsMiddleware()(ctx as never, globalCorsRefuses(ctx));

        expect(headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('overrides the global answer for the console’s own origin, and drops the credentials header beside the wildcard', async () => {
        const { ctx, headers } = contextFor('/nowplaying');

        await nowPlayingCorsMiddleware()(ctx as never, globalCorsAllows(ctx, 'https://radio.example'));

        expect(headers['Access-Control-Allow-Origin']).toBe('*');
        expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
    });

    it('leaves every other route to the credentialed allowlist', async () => {
        const { ctx, headers } = contextFor('/me/sessions');

        await nowPlayingCorsMiddleware()(ctx as never, globalCorsAllows(ctx, 'https://radio.example'));

        expect(headers['Access-Control-Allow-Origin']).toBe('https://radio.example');
        expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    });

    it('is this one path, and not a prefix', async () => {
        // A route added under it later has not argued that what it answers is public.
        for (const path of ['/nowplaying/history', '/nowplayingx']) {
            const { ctx, headers } = contextFor(path);

            await nowPlayingCorsMiddleware()(ctx as never, globalCorsRefuses(ctx));

            expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
        }
    });
});
