// The bridge secret reaches every singleton that signs with it in `StreamModule.ready`, which runs
// BEFORE `RenderModule.ready`. Render measures segments and pads at boot through URLs signed by
// `AudioUrlSigner`, which reads the secret from `LiquidsoapEndpoint`. When only `PlayoutModule.ready`
// pushed it there, render signed with the empty string, the sidecar was answered 401, and the same
// files failed to measure on every boot (live, 14 October).

import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import { describe, expect, it, vi } from 'vitest';

import { modules } from '../../../src/modules/modules.js';
import { LiquidsoapEndpoint } from '../../../src/modules/playout/liquidsoap.endpoint.js';
import { ApplePlayerClient } from '../../../src/modules/stream/apple.player.client.js';
import { SpotifyShimClient } from '../../../src/modules/stream/spotify.shim.client.js';
import { handOverBridgeSecrets } from '../../../src/modules/stream/stream.module.js';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
const config = { get: vi.fn((_key: string, fallback: unknown) => fallback) } as unknown as AppConfig;

describe('handOverBridgeSecrets', () => {
    it('pushes the bridge secret into the endpoint the URL signer reads, not only the helpers', () => {
        const endpoint = new LiquidsoapEndpoint(config, logger);
        const shim = new SpotifyShimClient(config, logger);
        const apple = new ApplePlayerClient(config, logger);
        const shimSecrets = vi.spyOn(shim, 'useSecrets');
        const appleSecrets = vi.spyOn(apple, 'useSecrets');
        const instances = new Map<unknown, unknown>([
            [LiquidsoapEndpoint, endpoint],
            [SpotifyShimClient, shim],
            [ApplePlayerClient, apple],
        ]);
        const container = { get: (token: unknown) => instances.get(token) } as unknown as Container;

        handOverBridgeSecrets(container, 'bridge', 'shim');

        expect(endpoint.secret()).toBe('bridge');
        expect(shimSecrets).toHaveBeenCalledWith('bridge', 'shim');
        expect(appleSecrets).toHaveBeenCalledWith('bridge');
    });

    it('runs in a module whose ready comes before render signs anything', () => {
        const names = modules.map(module => module.name);
        expect(names.indexOf('Stream')).toBeGreaterThanOrEqual(0);
        expect(names.indexOf('Stream')).toBeLessThan(names.indexOf('Render'));
    });
});
