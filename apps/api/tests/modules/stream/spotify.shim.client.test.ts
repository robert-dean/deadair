// The token this mints is verified by a different process, written in a different
// language: `verifyToken` in stream/spotify-shim/token.go. Nothing in TypeScript
// can catch a divergence, and the symptom would be every Spotify fetch 401ing on
// air with a working-looking app.
//
// So the wire format is pinned here against the SAME vector the Go suite pins
// (TestTokenMatchesTheAppsWireFormat), and a change to either side fails its own
// tests instead.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { TrackFetchSession } from '@deadair/plugin-sdk';

import {
    DEFAULT_SHIM_BASE_URL,
    signTrackToken,
    spotifyTrackUrl,
    SpotifyShimClient,
    TRACK_URL_TTL_MS,
} from '../../../src/modules/stream/spotify.shim.client.js';

/** The vector stream/spotify-shim/token_test.go pins. Do not change one without the other. */
const VECTOR = {
    secret: 's3cr3t',
    trackId: '4PTG3Z6ehGkBFwjybzWkR8',
    expirySeconds: 1785247352,
    token: '1785247352.6rV-wqRLfayJubNy9JWlD_tFoTyQXZHcvP7T_ewGdcg',
};

const SESSION: TrackFetchSession = { username: 'station', accessToken: 'a-token', expiresAt: 1785247352000 };

const configWith = (values: Record<string, string> = {}): AppConfig =>
    ({ get: (key: string, fallback: string) => values[key] ?? fallback }) as unknown as AppConfig;

const loggerStub = (): Logger => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as unknown as Logger;

/** A client with both secrets seeded, and a stub for whatever it POSTs at the shim. */
const clientWith = (values: Record<string, string> = {}, response: Response | Error = new Response(null, { status: 202 })) => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
        if (response instanceof Error) throw response;
        return response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new SpotifyShimClient(configWith(values), loggerStub());
    client.useSecrets(VECTOR.secret, 'shim-secret');
    return { client, fetchMock };
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('signTrackToken', () => {
    it('reproduces the vector the Go verifier pins', () => {
        expect(signTrackToken(VECTOR.secret, VECTOR.trackId, VECTOR.expirySeconds * 1000)).toBe(VECTOR.token);
    });

    it('signs the expiry, not just the id', () => {
        // The expiry travels in the clear, so without it in the MAC anyone holding an
        // expired URL could rewrite the expiry and keep using it.
        const a = signTrackToken(VECTOR.secret, VECTOR.trackId, 1_700_000_000_000);
        const b = signTrackToken(VECTOR.secret, VECTOR.trackId, 1_700_000_060_000);

        expect(a.split('.')[1]).not.toBe(b.split('.')[1]);
    });

    it('signs the track id, so one URL cannot be pointed at another track', () => {
        const a = signTrackToken(VECTOR.secret, 'trackA', VECTOR.expirySeconds * 1000);
        const b = signTrackToken(VECTOR.secret, 'trackB', VECTOR.expirySeconds * 1000);

        expect(a).not.toBe(b);
    });

    it('length-prefixes the fields so no two pairs sign the same bytes', () => {
        // "ab" + "1234" and "ab1" + "234" concatenate identically; the length prefix
        // is what keeps them apart. Mirrors the Go suite's boundary test.
        const a = signTrackToken(VECTOR.secret, 'ab', 1234 * 1000);
        const b = signTrackToken(VECTOR.secret, 'ab1', 234 * 1000);

        expect(a.split('.')[1]).not.toBe(b.split('.')[1]);
    });

    it('truncates the expiry to whole seconds, which is what the shim parses', () => {
        expect(signTrackToken(VECTOR.secret, VECTOR.trackId, VECTOR.expirySeconds * 1000 + 999)).toBe(VECTOR.token);
    });
});

describe('spotifyTrackUrl', () => {
    it('builds the route the shim serves', () => {
        expect(spotifyTrackUrl(DEFAULT_SHIM_BASE_URL, 'abc', '123.sig')).toBe('http://127.0.0.1:3679/track/abc?t=123.sig');
    });

    it('escapes the token, so a signature is never mangled in the query string', () => {
        expect(spotifyTrackUrl('http://x', 'abc', 'a+b/c=')).toContain('t=a%2Bb%2Fc%3D');
    });
});

describe('SpotifyShimClient', () => {
    it('mints a signed URL on the address Liquidsoap fetches from', async () => {
        const { client } = clientWith();

        const stream = await client.serve(VECTOR.trackId, SESSION);

        expect(stream?.url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:3679/track/${VECTOR.trackId}\\?t=\\d+\\.`));
        expect(stream?.mimeType).toBe('audio/ogg');
    });

    it('hands the shim the login before it hands out the URL', async () => {
        // The shim opens its own Spotify session, and the push is what makes the fetch
        // that follows find one already up rather than paying for a login on air.
        const { client, fetchMock } = clientWith();

        await client.serve(VECTOR.trackId, SESSION);

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe('http://127.0.0.1:3679/session');
        expect((init!.headers as Record<string, string>)['x-spotify-login-secret']).toBe('shim-secret');
        expect(JSON.parse(init!.body as string)).toEqual(SESSION);
    });

    it('stays inert until the bridge secret is seeded', async () => {
        // Signing with an empty secret would mint URLs the shim refuses outright, so
        // "no fetcher yet" has to read as no answer rather than a bad one.
        const client = new SpotifyShimClient(configWith(), loggerStub());
        client.useSecrets('', 'shim-secret');

        expect(await client.serve(VECTOR.trackId, SESSION)).toBeUndefined();
    });

    it('still mints a URL when the push does not land', async () => {
        // A shim that already holds a good session plays the item fine. Failing the
        // resolve would drop a track that would have aired.
        const { client } = clientWith({}, new Error('connection refused'));

        expect((await client.serve(VECTOR.trackId, SESSION))?.url).toContain('/track/');
    });

    it('still mints a URL when the push is refused', async () => {
        const { client } = clientWith({}, new Response(null, { status: 401 }));

        expect((await client.serve(VECTOR.trackId, SESSION))?.url).toContain('/track/');
    });

    // One address for both, because there is one consumer. The app pushes the session AND fetches the
    // track now — the player is handed `/playout/audio/{sourceId}` instead of a shim URL — so an
    // address that worked for one caller and not the other is the trap this collapse removes.
    it('signs the same address it pushes to', async () => {
        const { client, fetchMock } = clientWith({ SPOTIFY_SHIM_CONTROL_URL: 'http://liquidsoap:3679/' });

        const stream = await client.serve(VECTOR.trackId, SESSION);

        expect(fetchMock.mock.calls[0]![0]).toBe('http://liquidsoap:3679/session');
        expect(stream?.url).toContain('http://liquidsoap:3679/track/');
    });

    it('honours a shim moved off the stream container', async () => {
        const { client, fetchMock } = clientWith({ SPOTIFY_SHIM_URL: 'http://shim.internal:3679/' });

        expect((await client.serve(VECTOR.trackId, SESSION))?.url).toContain('http://shim.internal:3679/track/');
        expect(fetchMock.mock.calls[0]![0]).toBe('http://shim.internal:3679/session');
    });

    // `SPOTIFY_SHIM_URL` is the old player-facing key and is kept only so an operator's existing .env
    // keeps working. A station that sets both means the app-reachable one.
    it('prefers the app address when an install still sets both keys', async () => {
        const { client, fetchMock } = clientWith({
            SPOTIFY_SHIM_URL: 'http://liquidsoap:3679/',
            SPOTIFY_SHIM_CONTROL_URL: 'http://127.0.0.1:3679/',
        });

        expect((await client.serve(VECTOR.trackId, SESSION))?.url).toContain('http://127.0.0.1:3679/track/');
        expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:3679/session');
    });

    it('mints a URL that outlives the lead the pusher keeps', async () => {
        // An item is handed over one item ahead of air, so a TTL shorter than a track
        // would expire between the push and the fetch.
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(VECTOR.expirySeconds * 1000 - TRACK_URL_TTL_MS));
            const { client } = clientWith();

            const stream = await client.serve(VECTOR.trackId, SESSION);

            expect(TRACK_URL_TTL_MS).toBeGreaterThan(10 * 60_000);
            expect(stream?.url).toContain(encodeURIComponent(VECTOR.token));
            expect(stream?.expiresAt).toBe(VECTOR.expirySeconds * 1000);
        } finally {
            vi.useRealTimers();
        }
    });
});

// The authorization surface: what an operator is told about a fetcher that cannot fetch.
//
// The distinction every test here turns on is that a fetcher which is DOWN and a fetcher which was
// never AUTHORIZED are two states with two different things to do about them, and only one of them
// is worth sending somebody to a Spotify consent screen for. Reading them as one is what this
// station spent a day doing: a healthy plugin listing playlists above an audio path 502ing on every
// record, with nothing anywhere saying which half was wrong.
describe('the track fetcher authorization', () => {
    const healthy = (body: Record<string, unknown>) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

    it('reads a stored login as authorized, and a live session alone as not', async () => {
        // A session with no STORED login is the fetcher running on the token the app pushes it,
        // which Spotify's login refuses. So `session` is not the question; `storedLogin` is.
        const { client } = clientWith({}, healthy({ ok: true, session: true, storedLogin: false, loginError: 'INVALID_CREDENTIALS' }));

        const state = await client.authorization();

        expect(state.reachable).toBe(true);
        expect(state.authorized).toBe(false);
        expect(state.session).toBe(true);
        expect(state.loginError).toContain('INVALID_CREDENTIALS');
    });

    it('reports a fetcher that is not answering as unreachable rather than as unauthorized', async () => {
        const { client } = clientWith({}, new Error('ECONNREFUSED'));

        const state = await client.authorization();

        // Both false, and only the first is a reading. Told apart, because "authorize Spotify" is
        // useless advice to somebody whose fetcher is not running.
        expect(state.reachable).toBe(false);
        expect(state.authorized).toBe(false);
    });

    it('reports an install with no stream half as unconfigured without reaching for the network', async () => {
        const { fetchMock } = clientWith();
        const client = new SpotifyShimClient(configWith(), loggerStub());
        client.useSecrets(VECTOR.secret, '');

        const state = await client.authorization();

        expect(state.configured).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('carries the callback address the fetcher computed rather than guessing at one', async () => {
        // It comes off the fetcher's own listen address, so nothing here can derive it — and the
        // console uses it to say which page is expected to fail to load.
        const { client } = clientWith({}, healthy({ ok: true, session: false, storedLogin: true, callbackUrl: 'http://127.0.0.1:14000/login' }));

        expect((await client.authorization()).callbackUrl).toBe('http://127.0.0.1:14000/login');
    });

    it('keeps a refused attempt as 400, because that is the one the operator can fix', async () => {
        // Nothing pending, a stale URL, a callback from another authorization: start again and it
        // works. Everything else is not the operator's move.
        const { client } = clientWith({}, new Response('no authorization is pending', { status: 400 }));

        const result = await client.completeAuthorization('http://127.0.0.1:3679/login?code=a&state=b');

        expect(result).toEqual({ ok: false, status: 400, message: 'no authorization is pending' });
    });

    it('turns a secret the fetcher does not share into a setup fault, not a missing route', async () => {
        // The fetcher answers 404 when it holds no login secret and 401 when it holds a different
        // one. Relayed as they stand, those read as "no such route" and "your session was rejected",
        // and neither is what is wrong.
        for (const status of [401, 404]) {
            const { client } = clientWith({}, new Response('denied', { status }));

            expect(await client.beginAuthorization()).toEqual({
                ok: false,
                status: 503,
                message: expect.stringContaining('do not agree on a login secret'),
            });
        }
    });

    it('reads a fetcher that cannot be reached at all as 503 rather than as Spotify failing', async () => {
        const { client } = clientWith({}, new Error('ECONNREFUSED'));

        expect(await client.beginAuthorization()).toEqual({ ok: false, status: 503, message: 'the track fetcher is not answering' });
    });

    it('relays the pasted address whole, because the fetcher owns the one parser for it', async () => {
        const { client, fetchMock } = clientWith({}, healthy({ username: 'station' }));
        const pasted = 'http://127.0.0.1:3679/login?code=the-code&state=the-state';

        await client.completeAuthorization(pasted);

        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe(`${DEFAULT_SHIM_BASE_URL}/authorize/complete`);
        expect(JSON.parse(String(init?.body))).toEqual({ redirectUrl: pasted });
        expect((init?.headers as Record<string, string>)['x-spotify-login-secret']).toBe('shim-secret');
    });
});
