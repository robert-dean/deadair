// Icecast's `status-json.xsl` is the only thing that knows who is connected, and it
// is the boundary this file guards: the document changes shape depending on how many
// sources are up, and a consumer that assumes an array reads zero listeners on a
// station with exactly one mount — which is every deadair install.

import { describe, expect, it } from 'vitest';

import { listenersForMount, statsCandidates } from '../../../src/modules/stream/icecast.stats.client.js';

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
