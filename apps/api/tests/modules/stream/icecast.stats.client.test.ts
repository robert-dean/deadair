// Icecast is the only thing that knows who is connected, and it is the boundary this
// file guards. Two halves to it: the document changes shape depending on how many
// sources are up, and a consumer that assumes an array reads zero listeners on a
// station with exactly one mount — which is every deadair install; and the document
// now lives at two different addresses, one per Icecast generation, so which one gets
// asked (and how often the other is probed) is behaviour a test has to pin.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import {
    IcecastStatsClient,
    listenersForMount,
    overrideEndpoints,
    resolvedFirst,
    statsCandidates,
    statsEndpoints,
} from '../../../src/modules/stream/icecast.stats.client.js';
import { settingsConfig } from '../../utils/settings.config.js';

const source = (mount: string, listeners: number) => ({
    listenurl: `http://localhost:8000${mount}`,
    listeners,
});

describe('listenersForMount', () => {
    it('reads the count when several sources make `source` an array', () => {
        const body = { icestats: { source: [source('/other.mp3', 9), source('/live.mp3', 3)] } };

        expect(listenersForMount(body, '/live.mp3')).toBe(3);
    });

    it('reads the count when a single source makes `source` a bare object', () => {
        const body = { icestats: { source: source('/live.mp3', 2) } };

        expect(listenersForMount(body, '/live.mp3')).toBe(2);
    });

    it('is zero when the mount is not among the connected sources', () => {
        const body = { icestats: { source: [source('/other.mp3', 9)] } };

        expect(listenersForMount(body, '/live.mp3')).toBe(0);
    });

    it('is zero when no source is connected at all', () => {
        // Icecast omits the key entirely rather than sending an empty array. That is a
        // real answer — nobody is listening, because nothing is being served.
        expect(listenersForMount({ icestats: {} }, '/live.mp3')).toBe(0);
    });

    it('matches a mount written without its leading slash', () => {
        const body = { icestats: { source: source('/live.mp3', 4) } };

        expect(listenersForMount(body, 'live.mp3')).toBe(4);
    });

    it('does not match a mount that is merely a prefix of another', () => {
        const body = { icestats: { source: source('/live.mp3.backup', 7) } };

        expect(listenersForMount(body, '/live.mp3')).toBe(0);
    });

    it('reads zero from a body that is not a stats document', () => {
        expect(listenersForMount(undefined, '/live.mp3')).toBe(0);
        expect(listenersForMount('<html>401</html>', '/live.mp3')).toBe(0);
        expect(listenersForMount({ icestats: { source: 'nonsense' } }, '/live.mp3')).toBe(0);
    });
});

describe('statsCandidates', () => {
    it('offers the compose service and the host-published port', () => {
        expect(statsCandidates('icecast', '8000')).toEqual(['http://icecast:8000', 'http://127.0.0.1:8000']);
    });

    it('does not offer loopback twice when it is already the configured host', () => {
        expect(statsCandidates('127.0.0.1', '8000')).toEqual(['http://127.0.0.1:8000']);
    });
});

describe('statsEndpoints', () => {
    it('asks 2.5 before the endpoint it deprecates, on every address', () => {
        expect(statsEndpoints(['http://icecast:8000', 'http://127.0.0.1:8000'])).toEqual([
            { base: 'http://icecast:8000', path: '/admin/publicstats.json' },
            { base: 'http://icecast:8000', path: '/status-json.xsl' },
            { base: 'http://127.0.0.1:8000', path: '/admin/publicstats.json' },
            { base: 'http://127.0.0.1:8000', path: '/status-json.xsl' },
        ]);
    });

    it('puts the pair that answered first, and leaves no duplicate behind it', () => {
        const ordered = statsEndpoints(['http://icecast:8000', 'http://127.0.0.1:8000'], {
            base: 'http://127.0.0.1:8000',
            path: '/status-json.xsl',
        });

        expect(ordered[0]).toEqual({ base: 'http://127.0.0.1:8000', path: '/status-json.xsl' });
        expect(ordered).toHaveLength(4);
    });
});

describe('resolvedFirst', () => {
    it('drops a resolved endpoint the list no longer offers', () => {
        // The address came from settings that have since changed. Asking the old one
        // once per poll would cost a request nothing can answer.
        const all = [{ base: 'http://icecast:8000', path: '/status-json.xsl' }];

        expect(resolvedFirst(all, { base: 'http://gone:8000', path: '/status-json.xsl' })).toEqual(all);
    });
});

describe('overrideEndpoints', () => {
    it('is unset for an empty value', () => {
        expect(overrideEndpoints('')).toBeUndefined();
        expect(overrideEndpoints('   ')).toBeUndefined();
    });

    it('tries both endpoints against a base, trailing slash or not', () => {
        expect(overrideEndpoints('http://stream.example/')).toEqual([
            { base: 'http://stream.example', path: '/admin/publicstats.json' },
            { base: 'http://stream.example', path: '/status-json.xsl' },
        ]);
    });

    it('takes a whole endpoint at its word rather than probing its sibling', () => {
        expect(overrideEndpoints('http://stream.example/status-json.xsl')).toEqual([
            { base: 'http://stream.example', path: '/status-json.xsl' },
        ]);
        expect(overrideEndpoints('http://stream.example/admin/publicstats.json')).toEqual([
            { base: 'http://stream.example', path: '/admin/publicstats.json' },
        ]);
    });

    it('takes a document a proxy renamed at its word too', () => {
        expect(overrideEndpoints('http://stream.example/internal/stats.json')).toEqual([
            { base: 'http://stream.example/internal', path: '/stats.json' },
        ]);
    });
});

/** The stats document for a station with `count` people listening to `/live.mp3`. */
const document = (count: number) => ({ icestats: { source: source('/live.mp3', count) } });

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/** A `fetch` answering from a url→body table; anything unlisted is a 404. */
function stubFetch(answers: Record<string, unknown>) {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL) => {
        const asked = String(url);
        calls.push(asked);
        const body = answers[asked];
        if (body === undefined) return new Response('not found', { status: 404 });
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    return calls;
}

describe('IcecastStatsClient', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    /** A client pointed at loopback only, so the address table stays two rows long. */
    function client() {
        const stats = new IcecastStatsClient(settingsConfig().config, logger);
        stats.useMount({ host: '127.0.0.1', port: '8000', mount: '/live.mp3' });
        return stats;
    }

    it('reads the count from 2.5 publicstats when it is there', async () => {
        const calls = stubFetch({ 'http://127.0.0.1:8000/admin/publicstats.json': document(3) });

        await expect(client().listeners()).resolves.toBe(3);
        expect(calls).toEqual(['http://127.0.0.1:8000/admin/publicstats.json']);
    });

    it('falls back to the deprecated endpoint on a 2.4 server', async () => {
        const calls = stubFetch({ 'http://127.0.0.1:8000/status-json.xsl': document(2) });

        await expect(client().listeners()).resolves.toBe(2);
        expect(calls).toEqual(['http://127.0.0.1:8000/admin/publicstats.json', 'http://127.0.0.1:8000/status-json.xsl']);
    });

    it('probes the endpoint it does not have once, not once per poll', async () => {
        const calls = stubFetch({ 'http://127.0.0.1:8000/status-json.xsl': document(1) });
        const stats = client();

        await stats.listeners();
        await stats.listeners();
        await stats.listeners();

        // One probe of publicstats on the first read, and the endpoint that answered
        // for every read after it.
        expect(calls.filter(url => url.endsWith('/admin/publicstats.json'))).toHaveLength(1);
        expect(calls.filter(url => url.endsWith('/status-json.xsl'))).toHaveLength(3);
    });

    it('does not settle on JSON that is not a stats document', async () => {
        // A proxy's error body, or an SPA's index, answering 200 on one of the paths.
        // Settling there would read zero listeners forever and take the station off air.
        const calls = stubFetch({
            'http://127.0.0.1:8000/admin/publicstats.json': { error: 'nope' },
            'http://127.0.0.1:8000/status-json.xsl': document(4),
        });

        await expect(client().listeners()).resolves.toBe(4);
        expect(calls).toHaveLength(2);
    });

    it('is unknown, and re-probes from the top, when nothing answers', async () => {
        const calls = stubFetch({});
        const stats = client();

        await expect(stats.listeners()).resolves.toBeUndefined();
        await expect(stats.listeners()).resolves.toBeUndefined();

        expect(calls).toEqual([
            'http://127.0.0.1:8000/admin/publicstats.json',
            'http://127.0.0.1:8000/status-json.xsl',
            'http://127.0.0.1:8000/admin/publicstats.json',
            'http://127.0.0.1:8000/status-json.xsl',
        ]);
    });
});
