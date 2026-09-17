import { createFakePluginHost, fakeHostFetchResponse, type FakePluginHost } from '@deadair/plugin-sdk/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ResolverClient, resolverFor } from '../src/ytmusic.resolver.js';

const COOKIE = 'SID=abc; __Secure-3PAPISID=def';
const RESOLVED = {
    url: 'https://rr1---sn-x.googlevideo.com/videoplayback?expire=1789703389&id=abc',
    expiresAt: 1789703389000,
    mimeType: 'audio/webm',
    itag: '251',
    durationMs: 168000,
};

let host: FakePluginHost;
let resolver: ResolverClient;

beforeEach(() => {
    host = createFakePluginHost();
    resolver = new ResolverClient(host, 'http://localhost:9322');
});

describe('resolverFor', () => {
    it('answers nothing when the operator named no resolver', () => {
        // An unconfigured audio half is an ordinary state, not a fault.
        expect(resolverFor(host, undefined)).toBeUndefined();
        expect(resolverFor(host, '   ')).toBeUndefined();
    });

    it('refuses an address that is not http(s)', () => {
        expect(resolverFor(host, 'file:///etc/passwd')).toBeUndefined();
        expect(resolverFor(host, 'not a url')).toBeUndefined();
    });

    it('accepts a real address', () => {
        expect(resolverFor(host, 'http://localhost:9322')).toBeInstanceOf(ResolverClient);
    });
});

describe('resolve', () => {
    it('hands back the url with the expiry the resolver read off it', async () => {
        host.queueResponse({ status: 200, body: JSON.stringify(RESOLVED) });

        // expiresAt is the URL's OWN expire, not a TTL of ours: a URL that
        // outlives its upstream is an item that fails at the moment it airs.
        await expect(resolver.resolve('abc', COOKIE)).resolves.toEqual({
            url: RESOLVED.url,
            expiresAt: 1789703389000,
            mimeType: 'audio/webm',
        });
    });

    it('asks the resolver rather than YouTube', async () => {
        host.queueResponse({ status: 200, body: JSON.stringify(RESOLVED) });
        await resolver.resolve('abc', COOKIE);

        expect(host.calls[0]).toMatchObject({ url: 'http://localhost:9322/resolve', method: 'POST', body: '{"videoId":"abc"}' });
    });

    it.each([
        ['a record the upstream will not serve', 410, 'unavailable'],
        ['an account that is not Premium', 402, 'premium'],
        ['a format that is resting', 503, 'cooling'],
        ['anything else upstream', 502, 'upstream'],
    ])('answers undefined for %s', async (_label, status, code) => {
        // Every one of these is "this station cannot serve this track", which the
        // host reads as unavailable and skips. None of them is the plugin
        // misbehaving, and a throw here would count against its health and
        // eventually quarantine a catalog that works perfectly.
        host.queueResponse({ status, body: JSON.stringify({ code, message: code }) });
        await expect(resolver.resolve('abc', COOKIE)).resolves.toBeUndefined();
    });

    it('answers undefined when the resolver is not running at all', async () => {
        host.setFetchImpl(async () => {
            throw new Error('ECONNREFUSED');
        });
        await expect(resolver.resolve('abc', COOKIE)).resolves.toBeUndefined();
    });

    it('re-pushes the session and retries once when the resolver has lost it', async () => {
        // The resolver is a separate process with its own lifetime: it can restart
        // under a long-lived plugin and come back empty. The fix is to tell it again.
        const statuses = [401, 200, 200];
        const bodies = ['{"code":"auth"}', '{"ok":true}', JSON.stringify(RESOLVED)];
        let call = 0;
        host.setFetchImpl(async () => {
            const index = call++;
            return fakeHostFetchResponse({ status: statuses[index]!, body: bodies[index]! });
        });

        await expect(resolver.resolve('abc', COOKIE)).resolves.toMatchObject({ url: RESOLVED.url });
        expect(host.calls.map(c => c.url)).toEqual([
            'http://localhost:9322/resolve',
            'http://localhost:9322/session',
            'http://localhost:9322/resolve',
        ]);
    });

    it('gives up rather than looping when the re-push does not help', async () => {
        host.setFetchImpl(async () => fakeHostFetchResponse({ status: 401, body: '{"code":"auth"}' }));
        await expect(resolver.resolve('abc', COOKIE)).resolves.toBeUndefined();
        expect(host.calls.length).toBeLessThanOrEqual(3);
    });
});

describe('reachable', () => {
    it('reports an unreachable resolver rather than throwing', async () => {
        host.setFetchImpl(async () => {
            throw new Error('ECONNREFUSED');
        });
        await expect(resolver.reachable()).resolves.toMatchObject({ ok: false });
    });

    it('distinguishes up-with-a-session from up-without-one', async () => {
        host.queueResponse({ status: 200, body: '{"ok":true,"hasSession":true}' });
        await expect(resolver.reachable()).resolves.toMatchObject({ ok: true, message: expect.stringContaining('has the session') });

        host.queueResponse({ status: 200, body: '{"ok":true,"hasSession":false}' });
        await expect(resolver.reachable()).resolves.toMatchObject({ ok: true, message: expect.stringContaining('no session') });
    });
});
