// The token this mints is verified by a different process, written in a different
// language: `verifyToken` in stream/spotify-shim/token.go. Nothing in TypeScript
// can catch a divergence, and the symptom would be every Spotify fetch 401ing on
// air with a working-looking app.
//
// So the wire format is pinned here against the SAME vector the Go suite pins
// (TestTokenMatchesTheAppsWireFormat), and a change to either side fails its own
// tests instead.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import {
    DEFAULT_SHIM_BASE_URL,
    signTrackToken,
    spotifyTrackUrl,
    SpotifyShimResolver,
    TRACK_URL_TTL_MS,
} from '../../../src/modules/playout/providers/spotify.shim.resolver.js';
import type { LiquidsoapEndpoint } from '../../../src/modules/playout/liquidsoap.endpoint.js';
import type { RundownItem } from '../../../src/modules/playout/rundown.js';

/** The vector stream/spotify-shim/token_test.go pins. Do not change one without the other. */
const VECTOR = {
    secret: 's3cr3t',
    trackId: '4PTG3Z6ehGkBFwjybzWkR8',
    expirySeconds: 1785247352,
    token: '1785247352.6rV-wqRLfayJubNy9JWlD_tFoTyQXZHcvP7T_ewGdcg',
};

const configWith = (values: Record<string, string> = {}): AppConfig =>
    ({ get: (key: string, fallback: string) => values[key] ?? fallback }) as unknown as AppConfig;

const endpointWith = (secret: string): LiquidsoapEndpoint => ({ secret: () => secret }) as unknown as LiquidsoapEndpoint;

const item = (overrides: Partial<RundownItem> = {}): RundownItem => ({
    id: 'rundown-item-1',
    pluginId: 'deadair.spotify',
    externalId: VECTOR.trackId,
    title: 'A Track',
    artists: ['An Artist'],
    ...overrides,
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

describe('SpotifyShimResolver', () => {
    it('resolves its own plugin ids to a signed shim URL', async () => {
        const resolver = new SpotifyShimResolver(configWith(), endpointWith('a-secret'));

        const url = await resolver.resolve(item());

        expect(url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:3679/track/${VECTOR.trackId}\\?t=\\d+\\.`));
    });

    it('declines an item from another plugin', async () => {
        // Otherwise another provider's id is pasted into a shim URL and handed over
        // as valid, and the player discovers it on air rather than here.
        const resolver = new SpotifyShimResolver(configWith(), endpointWith('a-secret'));

        expect(await resolver.resolve(item({ pluginId: 'deadair.somethingelse' }))).toBeUndefined();
    });

    it('stays inert until the bridge secret is seeded', async () => {
        // Signing with an empty secret would mint URLs the shim refuses outright.
        const resolver = new SpotifyShimResolver(configWith(), endpointWith(''));

        expect(await resolver.resolve(item())).toBeUndefined();
    });

    it('honours a shim moved off the stream container', async () => {
        const resolver = new SpotifyShimResolver(configWith({ SPOTIFY_SHIM_URL: 'http://shim.internal:3679/' }), endpointWith('a-secret'));

        expect(await resolver.resolve(item())).toContain('http://shim.internal:3679/track/');
    });

    it('mints a URL that outlives the lead the pusher keeps', async () => {
        // An item is handed over one item ahead of air, so a TTL shorter than a track
        // would expire between the push and the fetch.
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(VECTOR.expirySeconds * 1000 - TRACK_URL_TTL_MS));
            const resolver = new SpotifyShimResolver(configWith(), endpointWith(VECTOR.secret));

            const url = await resolver.resolve(item());

            expect(TRACK_URL_TTL_MS).toBeGreaterThan(10 * 60_000);
            expect(url).toContain(encodeURIComponent(VECTOR.token));
        } finally {
            vi.useRealTimers();
        }
    });
});
