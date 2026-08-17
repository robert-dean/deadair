// One property, and it is the one nothing downstream can check: the engine is handed the TRANSPOSED
// script and the caller is told what that was. Everything about which plugin speaks and how the bytes
// reach disk is covered by the paths that use it; these cases exist because the words that go out
// stopped being the words on the row, and a caller that recorded the row's words instead would be
// recording something that was never said.

import { describe, expect, it, vi } from 'vitest';
import type { SpeechRequest } from '@deadair/plugin-sdk';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { SpeechService } from '../../../src/modules/render/speech.service.js';
import type { SpeechPlugin } from '../../../src/modules/plugins/plugin.capabilities.js';
import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { SegmentStore } from '../../../src/modules/render/segment.store.js';
import type { SpeechGate } from '../../../src/modules/render/speech.gate.js';
import type { VoiceSampleStore } from '../../../src/modules/render/voice.sample.store.js';

/** An engine that answers with a byte of audio and remembers what it was asked to say. */
function harness(pronunciations = '') {
    const asked: SpeechRequest[] = [];

    const speak = vi.fn(async (request: SpeechRequest) => {
        asked.push(request);
        return { mime: 'audio/mpeg', audio: new ReadableStream<Uint8Array>({ start: controller => controller.close() }) };
    });

    const plugin = { record: { id: 'deadair.kokoro' }, instance: { speak }, listsVoices: false } as unknown as SpeechPlugin;

    const registry = { list: vi.fn(() => []) } as unknown as PluginRegistry;
    const invoker = { invoke: vi.fn(async (_id: string, _name: string, run: () => Promise<unknown>) => await run()) } as unknown as PluginInvoker;
    const store = { writeStream: vi.fn(async () => 'checksum-1') } as unknown as SegmentStore;
    const gate = { hold: vi.fn(async (run: () => Promise<unknown>) => await run()) } as unknown as SpeechGate;
    const config = {
        get: vi.fn((_key: string, fallback: string) => (pronunciations.length > 0 ? pronunciations : fallback)),
    } as unknown as AppConfig;
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

    const service = new SpeechService(registry, invoker, config, store, gate, logger as never);

    return { service, plugin, asked, logger };
}

describe('SpeechService.speakWith', () => {
    it('hands the engine the transposed script and answers with what it said', async () => {
        const { service, plugin, asked } = harness('# nothing of my own\n');

        const audio = await service.speakWith(plugin, { text: 'That was Simon & Garfunkel, from 1968.' });

        expect(asked[0]?.text).toBe('That was Simon and Garfunkel, from nineteen sixty-eight.');
        expect(audio).toEqual({
            checksum: 'checksum-1',
            ext: 'mp3',
            pluginId: 'deadair.kokoro',
            spokenText: 'That was Simon and Garfunkel, from nineteen sixty-eight.',
        });
    });

    it('says a name the way the operator’s list says to', async () => {
        const { service, plugin, asked } = harness('Sade => Shar-day');

        await service.speakWith(plugin, { text: 'Here is Sade.' });

        expect(asked[0]?.text).toBe('Here is Shar-day.');
    });

    it('keeps the voice the caller asked for', async () => {
        const { service, plugin, asked } = harness();

        await service.speakWith(plugin, { text: 'The news at 9:00.', voice: 'newsreader' });

        expect(asked[0]).toMatchObject({ voice: 'newsreader', text: "The news at nine o'clock." });
    });

    it('says once, quoted, which entries an operator got wrong', async () => {
        const { service, plugin, logger } = harness('Sade => Shar-day\nthis line forgot the arrow');

        await service.speakWith(plugin, { text: 'Here is Sade.' });

        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('pronunciation entries'), { lines: ['this line forgot the arrow'] });
    });
});

describe('SpeechService.speakAs', () => {
    it('transposes a preview too, so it is what the station would actually say', async () => {
        const { service, plugin, asked } = harness();
        const samples = { writeStreamAs: vi.fn(async () => {}) } as unknown as VoiceSampleStore;

        await service.speakAs(plugin, 'sample-key', samples, { text: 'Live on FM, 24/7.' });

        expect(asked[0]?.text).toBe('Live on F M, twenty-four seven.');
    });
});
