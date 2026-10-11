// The seam between the app and `stream/apple-player`: the app signs, the container verifies, and neither
// can see the other's code. The token scheme is the Spotify shim's and is pinned on all three sides
// already, so what these assert is the rest of the contract — the path the container routes on, and the
// fetch budget without which every captured record is cut off mid-song.

import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import { describe, expect, it, vi } from 'vitest';

import {
    ApplePlayerClient,
    applePlayerTrackUrl,
    COMPOSE_APPLE_PLAYER_URL,
    PLAYER_FETCH_BUDGET_MS,
} from '../../../src/modules/stream/apple.player.client.js';
import { signTrackToken } from '../../../src/modules/stream/spotify.shim.client.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

const build = (settings: Record<string, string> = {}) => {
    const config = {
        get: vi.fn((key: string, fallback: unknown) => settings[key] ?? fallback),
    } as unknown as AppConfig;
    return new ApplePlayerClient(config, logger);
};

describe('ApplePlayerClient', () => {
    it('signs a URL the player will accept, on the path it routes', async () => {
        const client = build({ APPLE_PLAYER_URL: COMPOSE_APPLE_PLAYER_URL });
        client.useSecrets('s3cr3t');

        const stream = await client.serve('1440653203');

        // `/track/{id}?t=` is what the container matches on. A different shape here is a 404 that reads,
        // from the app's side, exactly like a record that could not be captured.
        expect(stream?.url).toMatch(/^http:\/\/apple-player:3680\/track\/1440653203\?t=\d+\.[\w-]+$/);
    });

    it('signs with the same scheme the Spotify shim verifies', async () => {
        // One signing function for both helpers, because it is the same kind of URL doing the same job.
        // If these two ever diverge, every Apple fetch 401s against a container that looks healthy.
        const client = build({ APPLE_PLAYER_URL: COMPOSE_APPLE_PLAYER_URL });
        client.useSecrets('s3cr3t');
        vi.setSystemTime(1_760_000_000_000);

        const token = new URL((await client.serve('abc'))!.url).searchParams.get('t');

        expect(token).toBe(signTrackToken('s3cr3t', 'abc', 1_760_000_000_000 + 30 * 60_000));
        vi.useRealTimers();
    });

    it('sends a fetch budget, because a capture runs in real time', async () => {
        // Without this the station's default 90-second ceiling applies and every record over 90 seconds is
        // truncated. It is the single field whose absence breaks the whole design quietly.
        const client = build({ APPLE_PLAYER_URL: COMPOSE_APPLE_PLAYER_URL });
        client.useSecrets('s3cr3t');

        expect((await client.serve('1440653203'))?.fetchBudgetMs).toBe(PLAYER_FETCH_BUDGET_MS);
    });

    it('answers undefined when no bridge secret has been seeded', async () => {
        // Nothing could verify a signature yet, so a URL minted now would be refused on air. The plugin
        // passes this straight through and the item is skipped rather than aired as silence.
        //
        // The address is set here on purpose: this asserts the SECRET branch, and a client with no address
        // returns before it reaches that branch (the test below covers that case). Leaving the address out
        // made this pass for the wrong reason.
        const client = build({ APPLE_PLAYER_URL: COMPOSE_APPLE_PLAYER_URL });

        expect(await client.serve('1440653203')).toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('answers undefined for an empty track id rather than signing a URL to nowhere', async () => {
        const client = build({ APPLE_PLAYER_URL: COMPOSE_APPLE_PLAYER_URL });
        client.useSecrets('s3cr3t');

        expect(await client.serve('')).toBeUndefined();
    });

    it('takes the operator address over the compose default, trailing slash and all', async () => {
        const client = build({ APPLE_PLAYER_URL: 'http://192.168.1.9:3680/' });
        client.useSecrets('s3cr3t');

        expect((await client.serve('abc'))?.url).toContain('http://192.168.1.9:3680/track/abc');
    });

    it('knows whether an operator has pointed the station at a player at all', () => {
        expect(build().configured()).toBe(false);
        expect(build({ APPLE_PLAYER_URL: 'http://apple-player:3680' }).configured()).toBe(true);
    });

    it('names the compose service rather than loopback', () => {
        // Unlike the Spotify shim, this is NOT inside the Liquidsoap container — it is a gigabyte of Chrome
        // with its own lifecycle, so the app reaches it across the network. And it is what compose SETS,
        // not a fallback the app applies: see the test above.
        expect(COMPOSE_APPLE_PLAYER_URL).toBe('http://apple-player:3680');
    });
});

describe('applePlayerTrackUrl', () => {
    it('encodes the id and the token', () => {
        expect(applePlayerTrackUrl('http://p:3680', 'a b', 'to/ken')).toBe('http://p:3680/track/a%20b?t=to%2Fken');
    });
});
