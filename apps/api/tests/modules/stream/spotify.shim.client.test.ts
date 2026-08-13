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
