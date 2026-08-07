// The rule under test is the same one for every capability: a manifest is a
// promise, and calling a method the plugin forgot to write is a `TypeError` in
// the middle of a request rather than an honest "not supported". So declaring
// and implementing are both required, and neither is evidence of the other.

import { describe, expect, it } from 'vitest';
import type { PluginInstance, PluginManifest } from '@deadair/plugin-sdk';

import { asCatalogPlugin, asStreamPlugin, implementsStream } from '../../../src/modules/plugins/plugin.capabilities.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';

const manifest = (capabilities: string[]): PluginManifest => ({ capabilities }) as unknown as PluginManifest;

const record = (capabilities: string[], instance: Record<string, unknown>, status: PluginRecord['status'] = 'active'): PluginRecord => ({
    id: 'deadair.example',
    dir: '/plugins/example',
    status,
    manifest: manifest(capabilities),
    instance: instance as unknown as PluginInstance,
});

/** Both routes to `stream`, and the catalog methods, as bare stubs. */
const resolveStreamUrl = async () => ({ url: 'https://example.test/a.mp3' });
const getSessionCredentials = async () => ({ username: 'station', accessToken: 'token' });
const catalogMethods = { listPlaylists: async () => [], getPlaylistTracks: async () => [] };

describe('asStreamPlugin', () => {
    it('accepts a plugin that mints URLs', () => {
        expect(asStreamPlugin(record(['catalog', 'stream'], { resolveStreamUrl }))).toBeDefined();
    });

    it('accepts a plugin that lends a login instead', () => {
        // Spotify's shape: no URL to hand out, because its audio comes off the CDN
        // encrypted, so the shim opens its own session. Same capability, other route.
        expect(asStreamPlugin(record(['catalog', 'stream'], { getSessionCredentials }))).toBeDefined();
    });

    it('refuses a plugin that declares stream and implements neither route', () => {
        expect(asStreamPlugin(record(['catalog', 'stream'], catalogMethods))).toBeUndefined();
    });

    it('refuses a plugin that implements a route but never declared it', () => {
        // The operator was never shown "this plugin will fetch audio", so the host
        // does not act on it. An undeclared capability is not a capability.
        expect(asStreamPlugin(record(['catalog'], { resolveStreamUrl }))).toBeUndefined();
    });

    it('refuses a plugin that is not running, however well it is written', () => {
        for (const status of ['discovered', 'disabled', 'misconfigured', 'failed'] as const) {
            expect(asStreamPlugin(record(['stream'], { resolveStreamUrl }, status))).toBeUndefined();
        }
    });

    it('is satisfied by either method, unlike catalog which needs all of its own', () => {
        // The asymmetry is deliberate: `catalog` is several methods that are all
        // needed to browse, `stream` is one job with two mutually exclusive routes.
        expect(implementsStream(manifest(['stream']), { resolveStreamUrl })).toBe(true);
        expect(implementsStream(manifest(['stream']), { getSessionCredentials })).toBe(true);
        expect(asCatalogPlugin(record(['catalog'], { listPlaylists: async () => [] }))).toBeUndefined();
    });
});

describe('asCatalogPlugin', () => {
    it('no longer cares whether the plugin can stream', () => {
        // A library that can be browsed but whose audio deadair cannot reach is a
        // legitimate thing to be, and it used to be indistinguishable from one that
        // could, because `resolveStreamUrl` hid inside the catalog interface.
        expect(asCatalogPlugin(record(['catalog'], catalogMethods))).toBeDefined();
    });
});
