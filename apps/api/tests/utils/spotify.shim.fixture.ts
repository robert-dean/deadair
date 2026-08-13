import { vi } from 'vitest';

import type { SpotifyShimClient } from '../../src/modules/stream/spotify.shim.client.js';

/**
 * Shared `SpotifyShimClient` test double for anything that only needs the
 * constructor satisfied. `PluginHostFactory` reaches it on exactly one
 * capability call, so a host test that never makes that call never touches
 * this; `serve` answering `undefined` is the honest reading of "no shim here".
 */
export const stubShimClient = (): SpotifyShimClient => ({ serve: vi.fn(async () => undefined) }) as unknown as SpotifyShimClient;
