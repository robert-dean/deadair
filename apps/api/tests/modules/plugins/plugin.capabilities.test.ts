// The rule under test is the same one for every capability: a manifest is a
// promise, and calling a method the plugin forgot to write is a `TypeError` in
// the middle of a request rather than an honest "not supported". So declaring
// and implementing are both required, and neither is evidence of the other.

import { describe, expect, it } from 'vitest';
import type { PluginInstance, PluginManifest } from '@deadair/plugin-sdk';

import {
    asAnalysisPlugin,
    asCatalogPlugin,
    asLlmPlugin,
    asMixerPlugin,
    asSpeechPlugin,
    asStreamPlugin,
    implementsStream,
} from '../../../src/modules/plugins/plugin.capabilities.js';
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
    /** The one method `speech` requires, as a bare stub. */
    const speechMethods = {
        speak: async () => ({ mime: 'audio/mpeg', audio: new ReadableStream<Uint8Array>() }),
    };

    it('accepts a plugin that can speak', () => {
        expect(asSpeechPlugin(record(['speech'], speechMethods))).toBeDefined();
    });

    it('refuses a plugin that declares speech and never wrote speak', () => {
        // The failure this prevents is worse than a missing capability: without
        // the check the segment would already be `rendering` and the `TypeError`
        // would land half way through the render.
        expect(asSpeechPlugin(record(['speech'], {}))).toBeUndefined();
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

describe('asLlmPlugin', () => {
    /** The one method `llm` requires, as a bare stub. */
    const llmMethods = {
        generate: async () => ({ text: new ReadableStream<string>(), result: Promise.resolve({ text: '', toolCalls: [], finishReason: 'stop' }) }),
    };

    it('accepts a plugin that can produce words', () => {
        expect(asLlmPlugin(record(['llm'], llmMethods))).toBeDefined();
    });

    it('refuses a plugin that declares llm and never wrote generate', () => {
        expect(asLlmPlugin(record(['llm'], {}))).toBeUndefined();
    });

    it('refuses a plugin that implements generate and never declared it', () => {
        expect(asLlmPlugin(record(['catalog'], llmMethods))).toBeUndefined();
    });

    it('refuses a plugin that is not running', () => {
        for (const status of ['discovered', 'disabled', 'misconfigured', 'failed'] as const) {
            expect(asLlmPlugin(record(['llm'], llmMethods, status))).toBeUndefined();
        }
    });

    it('reports whether the plugin can list its models, without requiring it', () => {
        // Optional in the SDK, but it costs more than `listVoices` does: tool
        // support is a property of the model, so a plugin that cannot describe
        // itself is never sent any tools.
        expect(asLlmPlugin(record(['llm'], llmMethods))?.listsModels).toBe(false);
        expect(asLlmPlugin(record(['llm'], { ...llmMethods, listModels: async () => [] }))?.listsModels).toBe(true);
    });
});

describe('asMixerPlugin', () => {
    /** The one method `mixer` requires, as a bare stub. */
    const mixerMethods = {
        join: async () => ({ mime: 'audio/flac', audio: new ReadableStream<Uint8Array>() }),
    };

    /** The one method `analysis` requires, as a bare stub. */
    const analysisMethods = { analyzeTrack: async () => ({ schemaVersion: 1, complete: true, data: {} }) };

    it('accepts a plugin that can join', () => {
        expect(asMixerPlugin(record(['mixer'], mixerMethods))).toBeDefined();
    });

    it('refuses a plugin that declares mixer and never wrote join', () => {
        expect(asMixerPlugin(record(['mixer'], {}))).toBeUndefined();
    });

    it('refuses a plugin that implements join and never declared it', () => {
        expect(asMixerPlugin(record(['analysis'], { ...analysisMethods, ...mixerMethods }))).toBeUndefined();
    });

    it('refuses a plugin that is not running', () => {
        for (const status of ['discovered', 'disabled', 'misconfigured', 'failed'] as const) {
            expect(asMixerPlugin(record(['mixer'], mixerMethods, status))).toBeUndefined();
        }
    });

    // The whole reason the capability was split off `analysis`. Joining used to be an optional
    // method there, so the joiner was whichever plugin the operator chose to MEASURE with: these
    // two views have to be able to disagree about one record, or the split bought nothing.
    it('is independent of the analysis view, in both directions', () => {
        const measuresOnly = record(['analysis'], analysisMethods);
        expect(asAnalysisPlugin(measuresOnly)).toBeDefined();
        expect(asMixerPlugin(measuresOnly)).toBeUndefined();

        const joinsOnly = record(['mixer'], mixerMethods);
        expect(asAnalysisPlugin(joinsOnly)).toBeUndefined();
        expect(asMixerPlugin(joinsOnly)).toBeDefined();

        // And one plugin answering both is ordinary rather than a special case: it is what the
        // bundled analyzer does, over one sidecar with one address.
        const both = record(['analysis', 'mixer'], { ...analysisMethods, ...mixerMethods });
        expect(asAnalysisPlugin(both)).toBeDefined();
        expect(asMixerPlugin(both)).toBeDefined();
    });
});
