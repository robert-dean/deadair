import { describe, expect, it } from 'vitest';

import { routedFetch, type FakeRoute } from '../../src/testing/fake.plugin.host.js';

const ping: FakeRoute = url => (url.pathname === '/ping' ? { body: { ok: true } } : undefined);
const gone: FakeRoute = url => (url.pathname === '/gone' ? { status: 404, body: 'no such thing' } : undefined);

describe('routedFetch', () => {
    it('answers with the first route that knows the URL, as JSON', async () => {
        const fetch = routedFetch([ping, gone]);
        const response = await fetch('http://server.test/ping?x=1');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        expect(response.url).toBe('http://server.test/ping?x=1');
    });

    it('sends a text body as it is and keeps the route status', async () => {
        const response = await routedFetch([ping, gone])('http://server.test/gone');

        expect(response.status).toBe(404);
        expect(await response.text()).toBe('no such thing');
    });

    it('prefers an earlier route over a later one for the same URL', async () => {
        const shadow: FakeRoute = url => (url.pathname === '/ping' ? { body: { shadowed: true } } : undefined);
        const response = await routedFetch([ping, shadow])('http://server.test/ping');

        expect(await response.json()).toEqual({ ok: true });
    });

    it('hands the route the request it was asked, so one path can answer per method', async () => {
        const method: FakeRoute = (url, init) => (url.pathname === '/item' ? { body: { method: init?.method ?? 'GET' } } : undefined);
        const response = await routedFetch([method])('http://server.test/item', { method: 'DELETE' });

        expect(await response.json()).toEqual({ method: 'DELETE' });
    });

    it('answers an unrouted call with a 500 so a missing route fails loudly', async () => {
        const response = await routedFetch([ping])('http://server.test/elsewhere');

        expect(response.status).toBe(500);
        expect(await response.text()).toBe('unrouted');
    });
});
