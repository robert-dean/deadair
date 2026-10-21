// ServerKit disposes a request's scope when the response CLOSES, and a client hanging up closes it
// too. Anything this middleware resolved from `ctx.container` after `next()` then threw "Cannot
// resolve from a disposed container", which turned the hang-up into a logged 500 on a request that
// had otherwise worked (live, 14 October). The jar is resolved before `next()` now, the way
// `auditContextMiddleware` resolves `AfterCommit`.

import { AppConfig } from '@maroonedsoftware/appconfig';
import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';

import { OIDC_STATE_COOKIE_NAME } from '../../../src/modules/authentication/oidc.state.cookie.js';

import { REFRESH_COOKIE_NAME } from '../../../src/modules/authentication/refresh.cookie.js';
import { RequestCookieJar } from '../../../src/modules/authentication/request.cookie.jar.js';
import { ResponseCookieJar } from '../../../src/modules/authentication/response.cookie.jar.js';
import { refreshCookieMiddleware } from '../../../src/server/middleware/refresh.cookie.middleware.js';

function request() {
    const jar = new ResponseCookieJar();
    const requestJar = new RequestCookieJar();
    const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;
    const res = { closed: false };
    let disposed = false;
    const container = {
        get: (token: unknown) => {
            if (disposed) throw new Error('Cannot resolve from a disposed container');
            if (token === ResponseCookieJar) return jar;
            if (token === RequestCookieJar) return requestJar;
            if (token === AppConfig) return config;
            throw new Error('unexpected token');
        },
        hangUp: () => {
            res.closed = true;
            disposed = true;
        },
    };
    const cookies = { get: vi.fn((_name: string): string | undefined => undefined), set: vi.fn(), secure: false };
    const ctx = {
        container,
        res,
        cookies,
        body: undefined as unknown,
        get: () => '',
        headers: {},
        protocol: 'http',
        secure: false,
    };
    return { ctx, jar, requestJar, cookies };
}

const run = (ctx: ReturnType<typeof request>['ctx'], handler: () => Promise<void>) => refreshCookieMiddleware()(ctx as never, handler);

describe('refreshCookieMiddleware', () => {
    it('does not fail the request when the client hung up before it returned', async () => {
        const { ctx } = request();

        await expect(run(ctx, async () => ctx.container.hangUp())).resolves.toBeUndefined();
    });

    it('does not fail a logout whose client hung up, and writes no cookie to nobody', async () => {
        const { ctx, jar, cookies } = request();

        await expect(
            run(ctx, async () => {
                jar.clearRefreshToken();
                ctx.container.hangUp();
            }),
        ).resolves.toBeUndefined();
        expect(cookies.set).not.toHaveBeenCalled();
    });

    it('still delivers a stashed refresh token when the client is there', async () => {
        const { ctx, jar, cookies } = request();

        await run(ctx, async () => jar.setRefreshToken('rt-1'));

        expect(cookies.set).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, 'rt-1', expect.objectContaining({ httpOnly: true }));
    });

    it('still clears the cookie when the route threw', async () => {
        const { ctx, jar, cookies } = request();

        await expect(
            run(ctx, async () => {
                jar.clearRefreshToken();
                throw new Error('401');
            }),
        ).rejects.toThrow('401');
        expect(cookies.set).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, null, expect.objectContaining({ maxAge: 0 }));
    });

    it('hands the OIDC state the browser presented to the request', async () => {
        const { ctx, requestJar, cookies } = request();
        cookies.get.mockImplementation(name => (name === OIDC_STATE_COOKIE_NAME ? 'state-1' : undefined));

        await run(ctx, async () => undefined);

        expect(requestJar.getOidcState()).toBe('state-1');
    });

    it('binds a started sign-in to the browser for as long as its state lives', async () => {
        const { ctx, jar, cookies } = request();

        await run(ctx, async () => jar.setOidcState('state-1', DateTime.utc().plus({ minutes: 10 })));

        const [name, value, options] = cookies.set.mock.calls[0]!;
        expect([name, value]).toEqual([OIDC_STATE_COOKIE_NAME, 'state-1']);
        expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax' });
        expect(options.maxAge).toBeGreaterThan(9 * 60 * 1000);
        expect(options.maxAge).toBeLessThanOrEqual(10 * 60 * 1000);
    });

    it('clears the OIDC state once a callback has used it', async () => {
        const { ctx, jar, cookies } = request();

        await run(ctx, async () => jar.clearOidcState());

        expect(cookies.set).toHaveBeenCalledWith(OIDC_STATE_COOKIE_NAME, null, expect.objectContaining({ maxAge: 0 }));
    });
});
