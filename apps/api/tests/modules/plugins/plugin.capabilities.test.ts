// The rule under test is the same one for every capability: a manifest is a
// promise, and calling a method the plugin forgot to write is a `TypeError` in
// the middle of a request rather than an honest "not supported". So declaring
// and implementing are both required, and neither is evidence of the other.

import { describe, expect, it } from 'vitest';
import type { PluginInstance, PluginManifest } from '@deadair/plugin-sdk';

import { asCatalogPlugin, asSpeechPlugin, asStreamPlugin, implementsStream } from '../../../src/modules/plugins/plugin.capabilities.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';

const manifest = (capabilities: string[]): PluginManifest => ({ capabilities }) as unknown as PluginManifest;

const record = (capabilities: string[], instance: Record<string, unknown>, status: PluginRecord['status'] = 'active'): PluginRecord => ({
    id: 'deadair.example',
    dir: '/plugins/example',
    status,
    manifest: manifest(capabilities),
    instance: instance as unknown as PluginInstance,
});

/** The `stream` method, and the catalog methods, as bare stubs. */
const resolveStreamUrl = async () => ({ url: 'https://example.test/a.mp3' });
const catalogMethods = { listPlaylists: async () => [], getPlaylistTracks: async () => [] };

describe('asStreamPlugin', () => {
    it('accepts a plugin that mints URLs', () => {
        expect(asStreamPlugin(record(['catalog', 'stream'], { resolveStreamUrl }))).toBeDefined();
    });

    it('refuses a plugin that declares stream and does not implement it', () => {
        expect(asStreamPlugin(record(['catalog', 'stream'], catalogMethods))).toBeUndefined();
    });

    it('refuses a plugin that implements the method but never declared it', () => {
        // The operator was never shown "this plugin will fetch audio", so the host
        // does not act on it. An undeclared capability is not a capability.
        expect(asStreamPlugin(record(['catalog'], { resolveStreamUrl }))).toBeUndefined();
    });

    it('refuses a plugin that is not running, however well it is written', () => {
        for (const status of ['discovered', 'disabled', 'misconfigured', 'failed'] as const) {
            expect(asStreamPlugin(record(['stream'], { resolveStreamUrl }, status))).toBeUndefined();
        }
    });

    it('asks the same method of every source, however its audio reaches the player', () => {
        // Including the ones with no URL of their own: Spotify's plugin lends the
        // shim a login through `host.trackFetcher` and returns the URL that comes
        // back, so from here it is a provider that resolves a URL like any other.
        // There is no second route to ask about, which is the point.
        expect(implementsStream(manifest(['stream']), { resolveStreamUrl })).toBe(true);
        expect(implementsStream(manifest(['stream']), { play: async () => {} })).toBe(false);
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

describe('asSpeechPlugin', () => {
    /** The three methods `speech` requires, as bare stubs. */
    const speechMethods = {
        speak: async () => ({ streamId: 's1', mime: 'audio/mpeg' }),
        readStream: async () => ({ seq: 0, done: true }),
        closeStream: async () => {},
    };

    it('accepts a plugin that can speak and be drained', () => {
        expect(asSpeechPlugin(record(['speech'], speechMethods))).toBeDefined();
    });

    it('refuses a plugin that can start speaking but cannot be drained', () => {
        // The failure this prevents is worse than a missing capability: `speak`
        // would succeed, the segment would already be `rendering`, and the
        // `TypeError` would land half way through the render.
        const { readStream: _readStream, ...withoutRead } = speechMethods;
        const { closeStream: _closeStream, ...withoutClose } = speechMethods;

        expect(asSpeechPlugin(record(['speech'], withoutRead))).toBeUndefined();
        expect(asSpeechPlugin(record(['speech'], withoutClose))).toBeUndefined();
    });

    it('refuses a plugin that implements speech and never declared it', () => {
        expect(asSpeechPlugin(record(['catalog'], speechMethods))).toBeUndefined();
    });

    it('refuses a plugin that is not running', () => {
        for (const status of ['discovered', 'disabled', 'misconfigured', 'failed'] as const) {
            expect(asSpeechPlugin(record(['speech'], speechMethods, status))).toBeUndefined();
        }
    });

    it('goes by the declared capability, which is the only axis there is', () => {
        // A manifest used to also carry a `kind` label that nothing dispatched
        // on. It is gone: declaring `speech` is what makes a speaker, and
        // declaring nothing makes one that cannot be called however it looks.
        expect(asSpeechPlugin({ ...record(['speech'], speechMethods), manifest: manifest(['speech']) })).toBeDefined();
        expect(asSpeechPlugin(record([], speechMethods))).toBeUndefined();
    });

    it('reports whether the plugin can list its voices, without requiring it', () => {
        // Optional in the SDK: a plugin with exactly one voice is a legitimate
        // thing to be and should not have to describe it.
        expect(asSpeechPlugin(record(['speech'], speechMethods))?.listsVoices).toBe(false);
        expect(asSpeechPlugin(record(['speech'], { ...speechMethods, listVoices: async () => [] }))?.listsVoices).toBe(true);
    });
});
