// What counts as a heartbeat, which is the whole of this middleware. Count too much and an
// audience-gated station stays on air for clients it is handing errors to — measured on a live
// station: HLS switched off, every playlist deleted, nothing listening, two listeners reported.
// Count too little and somebody genuinely tuned in is never noticed, and the station goes quiet
// with them listening to it.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { HlsAudience } from '../../../src/modules/stream/hls.audience.js';
import { clientKey, hlsHeartbeatMiddleware } from '../../../src/server/middleware/hls.heartbeat.middleware.js';

const PEER = '172.18.0.4';

/** Trusts the edge, as the production image does, and refuses nobody. */
const config = { get: (key: string, fallback: unknown) => (key === 'TRUST_PROXY' ? 'true' : fallback) } as AppConfig;

/** The same, with an operator's refusal list on it. */
const configRefusing = (list: string): AppConfig =>
    ({
        get: (key: string, fallback: unknown) => {
            if (key === 'TRUST_PROXY') return 'true';
            if (key === 'stream.hlsRefuseAgents') return list;
            return fallback;
        },
    }) as AppConfig;

/**
 * A request as Koa presents it, plus the register the middleware resolves out of the scope.
 *
 * `status` starts at 404, which is Koa's own default for a response nobody has written: a
 * handler that sets nothing has not served anybody, and the middleware has to agree.
 */
const contextFor = (path: string, agent = 'player/1.0') => {
    const audience = new HlsAudience();

    return {
        audience,
        ctx: {
            path,
            ip: PEER,
            status: 404,
            req: { headers: { 'x-real-ip': '203.0.113.7', 'user-agent': agent } },
            container: { get: () => audience },
        },
    };
};

/** A handler that answers the way the playlist route does when the file is there. */
const serves = (ctx: { status: number }) => async () => {
    ctx.status = 200;
};

describe('hlsHeartbeatMiddleware', () => {
    it('counts a playlist that was served', async () => {
        const { ctx, audience } = contextFor('/hls/mp3.m3u8');

        await hlsHeartbeatMiddleware(config)(ctx as never, serves(ctx));

        expect(audience.count()).toBe(1);
    });

    it('does NOT count a playlist the station refused', async () => {
        // The live failure: HLS off, the playlists deleted, and a client polling the URL every
        // few seconds. Every one of those requests used to be a heartbeat, so the gate never
        // closed and the station kept producing a programme for nobody.
        const { ctx, audience } = contextFor('/hls/mp3.m3u8');

        await hlsHeartbeatMiddleware(config)(
            ctx as never,
            vi.fn(async () => {}),
        );

        expect(audience.count()).toBe(0);
    });

    it('does NOT count a request that threw, and lets the error through untouched', async () => {
        // `getHlsPlaylist` refuses by THROWING an httpError rather than by setting a status, so
        // a status check alone would never see it. Recording after `next()` covers both.
        const { ctx, audience } = contextFor('/hls/mp3.m3u8');
        const boom = new Error('no such playlist');

        await expect(
            hlsHeartbeatMiddleware(config)(ctx as never, async () => {
                throw boom;
            }),
        ).rejects.toBe(boom);

        expect(audience.count()).toBe(0);
    });

    it('ignores the segments, which nginx serves and which would multiply one listener into a crowd', async () => {
        const { ctx, audience } = contextFor('/hls/mp3_31912.mp3');

        await hlsHeartbeatMiddleware(config)(ctx as never, serves(ctx));

        expect(audience.count()).toBe(0);
    });

    it('ignores a path that merely starts the same way', async () => {
        // The trailing slash on the prefix is what stops a future `/hlsx` being counted.
        const { ctx, audience } = contextFor('/hlsx/mp3.m3u8');

        await hlsHeartbeatMiddleware(config)(ctx as never, serves(ctx));

        expect(audience.count()).toBe(0);
    });

    it('counts two players on one address separately, and one player once', async () => {
        // Address plus user agent: the address alone would collapse a household, and the agent
        // alone would collapse everyone using the same player.
        const first = contextFor('/hls/mp3.m3u8', 'player/1.0');
        const second = contextFor('/hls/mp3.m3u8', 'other/2.0');
        const middleware = hlsHeartbeatMiddleware(config);

        await middleware(first.ctx as never, serves(first.ctx));
        await middleware(second.ctx as never, serves(second.ctx));

        expect(clientKey(first.ctx as never, true)).not.toBe(clientKey(second.ctx as never, true));

        // Each context carries its own register here, so the meaningful assertion is the key.
        // Two ticks into ONE register:
        const shared = new HlsAudience();
        shared.seen(clientKey(first.ctx as never, true));
        shared.seen(clientKey(first.ctx as never, true));
        expect(shared.count()).toBe(1);
        shared.seen(clientKey(second.ctx as never, true));
        expect(shared.count()).toBe(2);
    });
});

describe('hlsHeartbeatMiddleware, refusing what the operator named', () => {
    it('refuses a named player with 403 and never reaches the handler', async () => {
        const { ctx, audience } = contextFor('/hls/mp3.m3u8', 'Lavf/59.27.100');
        const next = vi.fn(async () => {});

        const thrown = await hlsHeartbeatMiddleware(configRefusing('Lavf/'))(ctx as never, next).catch(
            (error: unknown) => error as { status?: number; statusCode?: number },
        );

        expect(thrown.status ?? thrown.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
        // The point of the whole thing: a client the station refuses is not an audience, so an
        // audience-gated station stops producing a programme for it.
        expect(audience.count()).toBe(0);
    });

    it('serves and counts everybody the list does not name', async () => {
        const { ctx, audience } = contextFor('/hls/mp3.m3u8', 'TuneIn Radio/42.3 (Linux;Android 17) AndroidXMedia3/1.10.1');

        await hlsHeartbeatMiddleware(configRefusing('Lavf/ Go-http-client'))(ctx as never, serves(ctx));

        expect(audience.count()).toBe(1);
    });

    it('refuses nothing while the setting is empty, which is every station by default', async () => {
        const { ctx, audience } = contextFor('/hls/mp3.m3u8', 'Lavf/59.27.100');

        await hlsHeartbeatMiddleware(configRefusing(''))(ctx as never, serves(ctx));

        expect(audience.count()).toBe(1);
    });

    it('does not refuse a named player on a path that is not a playlist', async () => {
        // The list is about the heartbeat, and the segments are nginx's in every real deployment.
        // Refusing here as well would be a rule enforced in one deployment and not the other.
        const { ctx } = contextFor('/hls/mp3_31912.mp3', 'Lavf/59.27.100');
        const next = vi.fn(async () => {});

        await hlsHeartbeatMiddleware(configRefusing('Lavf/'))(ctx as never, next);

        expect(next).toHaveBeenCalledOnce();
    });
});

describe('clientKey', () => {
    it('reads the forwarded address the rate limiter does, once the edge is trusted', () => {
        const { ctx } = contextFor('/hls/mp3.m3u8');

        expect(clientKey(ctx as never, true)).toBe('203.0.113.7 player/1.0');
    });

    it('falls back to the peer when the edge is not trusted', () => {
        const { ctx } = contextFor('/hls/mp3.m3u8');

        expect(clientKey(ctx as never, false)).toBe(`${PEER} player/1.0`);
    });
});
