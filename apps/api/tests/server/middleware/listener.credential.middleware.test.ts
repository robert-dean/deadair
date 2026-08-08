// ServerKit's authentication middleware deletes the Authorization header from every
// request before any route runs, which is right for an API whose only credential is a
// bearer session and fatal for the one caller that cannot send anything else. Icecast's
// URL authenticator presents the bridge secret as HTTP basic; if this middleware stops
// moving it, every listener is refused the mount by an app that meant to admit them.

import { describe, expect, it, vi } from 'vitest';

import { basicPassword, LISTENER_HOOK_PATH, listenerCredentialMiddleware } from '../../../src/server/middleware/listener.credential.middleware.js';

/** A request as Koa presents it, with only the parts this middleware touches. */
const request = (path: string, headers: Record<string, string> = {}) => ({ path, req: { headers } });

const run = async (ctx: ReturnType<typeof request>) => {
    const next = vi.fn(async () => {});
    // The middleware only reads `path` and `req.headers`; the rest of the Koa context is
    // not its business and is deliberately not stubbed.
    await listenerCredentialMiddleware()(ctx as never, next);
    return next;
};

describe('listenerCredentialMiddleware', () => {
    it('moves a basic credential onto the header the playout bridge already uses', async () => {
        const credential = Buffer.from('deadair:the-secret').toString('base64');
        const ctx = request(LISTENER_HOOK_PATH, { authorization: `Basic ${credential}` });

        await run(ctx);

        expect(ctx.req.headers['x-playout-secret']).toBe('the-secret');
        // Moved rather than copied: left in place, the authentication middleware behind
        // this warns about an unknown `basic` scheme once per listener, forever.
        expect(ctx.req.headers.authorization).toBeUndefined();
    });

    it('leaves a secret the caller sent directly alone', async () => {
        // The two ways of presenting it are equivalent, not ranked.
        const ctx = request(LISTENER_HOOK_PATH, {
            authorization: `Basic ${Buffer.from('deadair:from-basic').toString('base64')}`,
            'x-playout-secret': 'sent-directly',
        });

        await run(ctx);

        expect(ctx.req.headers['x-playout-secret']).toBe('sent-directly');
    });

    it('leaves a header it could make nothing of alone', async () => {
        const ctx = request(LISTENER_HOOK_PATH, { authorization: 'Bearer not-a-basic-credential' });

        await run(ctx);

        expect(ctx.req.headers.authorization).toBe('Bearer not-a-basic-credential');
        expect(ctx.req.headers['x-playout-secret']).toBeUndefined();
    });

    it('touches nothing on any other path', async () => {
        // A bearer session must never be turned into a bridge credential, whatever it holds.
        const ctx = request('/playout/status', { authorization: 'Bearer a-session-token' });

        await run(ctx);

        expect(ctx.req.headers['x-playout-secret']).toBeUndefined();
    });

    it('always calls through', async () => {
        const next = await run(request('/nowplaying'));

        expect(next).toHaveBeenCalledOnce();
    });
});

describe('basicPassword', () => {
    it('reads the password and ignores the username', () => {
        expect(basicPassword(`Basic ${Buffer.from('anyone:secret').toString('base64')}`)).toBe('secret');
    });

    it('keeps a password containing a colon whole', () => {
        expect(basicPassword(`Basic ${Buffer.from('deadair:a:b:c').toString('base64')}`)).toBe('a:b:c');
    });

    it('is empty for anything that is not basic', () => {
        expect(basicPassword('Bearer a-session-token')).toBe('');
        expect(basicPassword('Basic')).toBe('');
        expect(basicPassword(undefined)).toBe('');
        expect(basicPassword(`Basic ${Buffer.from('no-separator').toString('base64')}`)).toBe('');
    });
});
