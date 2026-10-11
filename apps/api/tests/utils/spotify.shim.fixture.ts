import { vi } from 'vitest';

import type { SpotifyShimClient } from '../../src/modules/stream/spotify.shim.client.js';
import type { ApplePlayerClient } from '../../src/modules/stream/apple.player.client.js';

/**
 * Shared `SpotifyShimClient` test double for anything that only needs the
 * constructor satisfied. `PluginHostFactory` reaches it on two capability
 * calls, so a host test that makes neither never touches this; answering
 * "no shim here" to both is the honest default — `undefined` for a track, and
 * the 503 the client itself answers with when nothing is set up.
 */
export const stubShimClient = (): SpotifyShimClient =>
    ({
        serve: vi.fn(async () => undefined),
        playlistTracks: vi.fn(async () => ({
            ok: false,
            status: 503,
            message: 'the track fetcher has no login secret, so the stream half of this install has not been set up yet',
        })),
    }) as unknown as SpotifyShimClient;

/**
 * The same for {@link ApplePlayerClient}, whose one capability call is `servePlayer`.
 *
 * "This station has no player" is the honest default here too: it is what a station that never set the
 * stream half up answers, and a plugin is expected to pass it straight through as "cannot resolve this
 * item" rather than treat it as a fault.
 */
export const stubApplePlayerClient = (): ApplePlayerClient =>
    ({
        serve: vi.fn(async () => undefined),
        configured: vi.fn(() => false),
    }) as unknown as ApplePlayerClient;
