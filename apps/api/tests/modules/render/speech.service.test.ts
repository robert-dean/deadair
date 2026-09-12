// One property, and it is the one nothing downstream can check: the engine is handed the TRANSPOSED
// script and the caller is told what that was. Everything about which plugin speaks and how the bytes
// reach disk is covered by the paths that use it; these cases exist because the words that go out
// stopped being the words on the row, and a caller that recorded the row's words instead would be
// recording something that was never said.

import { describe, expect, it, vi } from 'vitest';
import type { SpeechCue, SpeechDelivery, SpeechRequest } from '@deadair/plugin-sdk';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { SpeechService } from '../../../src/modules/render/speech.service.js';
import type { SpeechPlugin } from '../../../src/modules/plugins/plugin.capabilities.js';
import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { Pronunciation } from '../../../src/modules/render/pronunciation.lexicon.js';
import type { PronunciationRepository } from '../../../src/modules/render/pronunciation.repository.js';
import type { SegmentStore } from '../../../src/modules/render/segment.store.js';
import type { SpeechGate } from '../../../src/modules/render/speech.gate.js';
import type { VoiceSampleStore } from '../../../src/modules/render/voice.sample.store.js';

/**
 * An engine that answers with a byte of audio and remembers what it was asked to say.
 *
 * `cues` is what this engine CLAIMS it can perform; absent means it does not implement the method at
 * all, which is most plugins and is the shape that has to keep working untouched. `deliveries` is the
 * same, one field over.
 */
function harness(entries: readonly Pronunciation[] = [], cues?: readonly SpeechCue[], deliveries?: readonly SpeechDelivery[] | 'throws') {
    const asked: SpeechRequest[] = [];

    const speak = vi.fn(async (request: SpeechRequest) => {
        asked.push(request);
        return { mime: 'audio/mpeg', audio: new ReadableStream<Uint8Array>({ start: controller => controller.close() }) };
    });

    const listDeliveries = vi.fn(async () => {
        if (deliveries === 'throws') throw new Error('engine unreachable');
        return deliveries ?? [];
    });
    const instance = {
        speak,
        ...(cues === undefined ? {} : { listCues: vi.fn(async () => cues) }),
        ...(deliveries === undefined ? {} : { listDeliveries }),
    };
    const plugin = {
        record: { id: 'deadair.kokoro' },
        instance,
        listsVoices: false,
        listsCues: cues !== undefined,
        listsDeliveries: deliveries !== undefined,
    } as unknown as SpeechPlugin;

    const registry = { list: vi.fn(() => []) } as unknown as PluginRegistry;
    const invoker = { invoke: vi.fn(async (_id: string, _name: string, run: () => Promise<unknown>) => await run()) } as unknown as PluginInvoker;
    const store = { writeStream: vi.fn(async () => 'checksum-1') } as unknown as SegmentStore;
    const gate = { hold: vi.fn(async (run: () => Promise<unknown>) => await run()) } as unknown as SpeechGate;
    const config = { get: vi.fn((_key: string, fallback: string) => fallback) } as unknown as AppConfig;
    const lexicon = { active: vi.fn(async () => entries) } as unknown as PronunciationRepository;
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

    const service = new SpeechService(registry, invoker, config, store, gate, lexicon, logger as never);

    return { service, plugin, asked, lexicon, logger, listDeliveries };
}

describe('SpeechService.speakWith', () => {
    it('hands the engine the transposed script and answers with what it said', async () => {
        const { service, plugin, asked } = harness();

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
        const { service, plugin, asked } = harness([{ written: 'Sade', spoken: 'Shar-day' }]);

        await service.speakWith(plugin, { text: 'Here is Sade.' });

        expect(asked[0]?.text).toBe('Here is Shar-day.');
    });

    it('keeps the voice the caller asked for', async () => {
        const { service, plugin, asked } = harness();

        await service.speakWith(plugin, { text: 'The news at 9:00.', voice: 'newsreader' });

        expect(asked[0]).toMatchObject({ voice: 'newsreader', text: "The news at nine o'clock." });
    });

    it('reads the lexicon on every render, so an edit is heard on the next break', async () => {
        const { service, plugin, lexicon } = harness([{ written: 'Sade', spoken: 'Shar-day' }]);

        await service.speakWith(plugin, { text: 'Here is Sade.' });
        await service.speakWith(plugin, { text: 'Here is Sade again.' });

        expect(lexicon.active).toHaveBeenCalledTimes(2);
    });
});

// The property that makes a performance cue safe to write into a script at all: the RENDER path
// decides whether one survives, not the writer. A break written while Chatterbox was the speaker and
// rendered after the operator switched to Kokoro has to lose its cue, because written and rendered
// are different moments and only one of them knows which engine is about to be handed the words.
describe('SpeechService.speakWith: performance cues', () => {
    it('takes a cue out for an engine that does not claim it', async () => {
        const { service, plugin, asked } = harness([], []);

        await service.speakWith(plugin, { text: 'That was Nick Drake. [laugh] No idea what follows.' });

        expect(asked[0]?.text).toBe('That was Nick Drake. No idea what follows.');
    });

    it('takes a cue out for an engine that does not implement the method at all', async () => {
        // Absent means none, which is what lets every existing speech plugin stay untouched.
        const { service, plugin, asked } = harness();

        await service.speakWith(plugin, { text: 'That was Nick Drake. [laugh] No idea what follows.' });

        expect(asked[0]?.text).toBe('That was Nick Drake. No idea what follows.');
    });

    it('leaves a cue in for an engine that claims it', async () => {
        const { service, plugin, asked } = harness([], ['laugh']);

        await service.speakWith(plugin, { text: 'That was Nick Drake. [laugh] No idea what follows.' });

        expect(asked[0]?.text).toBe('That was Nick Drake. [laugh] No idea what follows.');
    });

    it('keeps only the cues that engine claimed, not all of them', async () => {
        const { service, plugin, asked } = harness([], ['laugh']);

        await service.speakWith(plugin, { text: '[sigh] Well. [laugh] Anyway.' });

        expect(asked[0]?.text).toBe('Well. [laugh] Anyway.');
    });

    it('records the cue in what it says was spoken, because that is what went out', async () => {
        const { service, plugin } = harness([], ['laugh']);

        const audio = await service.speakWith(plugin, { text: '[laugh] Right then.' });

        expect(audio.spokenText).toBe('[laugh] Right then.');
    });

    it('does not let a plugin that throws cost the render', async () => {
        // A cue is a flourish. An engine that could not be asked whether it does them should cost a
        // plainer break rather than the break.
        const { service, plugin, asked } = harness([], []);
        (plugin.instance as { listCues: unknown }).listCues = vi.fn(async () => {
            throw new Error('connection refused');
        });

        await service.speakWith(plugin, { text: '[laugh] Still fine.' });

        expect(asked[0]?.text).toBe('Still fine.');
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

// A delivery is the cue rule one field over: the RENDER path decides whether it survives, because
// only this moment knows which engine is about to be handed the line. What these pin is the safe
// direction, which is that an engine never sees a delivery it did not claim.
describe('SpeechService.speakWith: deliveries', () => {
    it('drops a delivery for an engine that does not implement the method at all', async () => {
        // Kokoro today, and every speech plugin written before deliveries existed.
        const { service, plugin, asked } = harness();

        await service.speakWith(plugin, { text: 'Something is out there.', delivery: 'hushed' });

        expect(asked[0]).not.toHaveProperty('delivery');
        expect(asked[0]?.text).toBe('Something is out there.');
    });

    it('drops a delivery the engine does not claim, and keeps one it does', async () => {
        const { service, plugin, asked } = harness([], undefined, ['hushed']);

        await service.speakWith(plugin, { text: 'Go.', delivery: 'frantic' });
        await service.speakWith(plugin, { text: 'Quiet now.', delivery: 'hushed' });

        expect(asked[0]).not.toHaveProperty('delivery');
        expect(asked[1]?.delivery).toBe('hushed');
    });

    it('does not ask the engine anything for an ordinary line', async () => {
        // Nearly every line carries no delivery, and asking would be a round trip per break for nothing.
        const { service, plugin, listDeliveries } = harness([], undefined, ['hushed', 'frantic']);

        await service.speakWith(plugin, { text: 'That was Nick Drake.' });

        expect(listDeliveries).not.toHaveBeenCalled();
    });

    it('costs an ordinary reading rather than the render when the engine cannot be asked', async () => {
        const { service, plugin, asked } = harness([], undefined, 'throws');

        await service.speakWith(plugin, { text: 'Go.', delivery: 'frantic' });

        expect(asked[0]).not.toHaveProperty('delivery');
    });

    it('keeps the voice and the transposition alongside a delivery', async () => {
        const { service, plugin, asked } = harness([], undefined, ['frantic']);

        await service.speakWith(plugin, { text: 'The news at 9:00.', voice: 'newsreader', delivery: 'frantic' });

        expect(asked[0]).toEqual({ text: "The news at nine o'clock.", voice: 'newsreader', delivery: 'frantic' });
    });
});
