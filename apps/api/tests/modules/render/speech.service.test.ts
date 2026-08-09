// The claim under test is that the audio never exists whole in this process: `speak` hands back a
// stream and the service pipes it into a store that hashes as it writes. The fake plugin therefore
// hands over a body in pieces and records whether it was cancelled, rather than returning a buffer
// and letting the assertions be about its contents alone.

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginError, isPluginError, type PluginErrorCode, type SpeechPluginInstance } from '@deadair/plugin-sdk';

import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { settingsConfig } from '../../utils/settings.config.js';
import { SegmentStore } from '../../../src/modules/render/segment.store.js';
import { SpeechService } from '../../../src/modules/render/speech.service.js';
import { SPEECH_PLUGIN_KEY } from '../../../src/modules/render/speech.settings.js';

let root: string;
let store: SegmentStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-speech-test-'));
    store = new SegmentStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

/**
 * An invoker that just runs the work, like the real one does on the happy path. The breaker and the
 * deadline are `PluginInvoker`'s own business and are tested there.
 */
const passthroughInvoker = () =>
    ({ invoke: vi.fn(async (_id: string, _op: string, work: () => Promise<unknown>) => work()) }) as unknown as PluginInvoker;

interface FakePluginOptions {
    id?: string;
    mime?: string;
    /** The pieces the audio arrives in, in order. */
    chunks?: Buffer[];
    speakError?: PluginError;
    /** Thrown from the stream instead of its last chunk, for the broken-engine case. */
    streamError?: PluginError;
    listVoices?: boolean;
}

function fakeSpeechPlugin(options: FakePluginOptions = {}) {
    const id = options.id ?? 'deadair.kokoro';
    const chunks = options.chunks ?? [Buffer.from('some audio bytes')];

    /** How many times the source was asked for more, so a test can tell streaming from buffering. */
    let pulls = 0;
    let cancelled = false;

    const audio = (): ReadableStream<Uint8Array> => {
        let cursor = 0;
        return new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls += 1;
                if (options.streamError) throw options.streamError;
                if (cursor >= chunks.length) {
                    controller.close();
                    return;
                }
                controller.enqueue(new Uint8Array(chunks[cursor++]!));
            },
            cancel() {
                cancelled = true;
            },
        });
    };

    const instance = {
        speak: vi.fn(async () => {
            if (options.speakError) throw options.speakError;
            return { mime: options.mime ?? 'audio/mpeg', audio: audio() };
        }),
        ...(options.listVoices ? { listVoices: vi.fn(async () => [{ id: 'host', label: 'Station host' }]) } : {}),
    } as unknown as SpeechPluginInstance;

    const record = { id, status: 'active', manifest: { capabilities: ['speech'] }, instance } as unknown as PluginRecord;

    return { record, instance, pulls: () => pulls, wasCancelled: () => cancelled };
}

function service(records: PluginRecord[], configured?: string) {
    const pluginRegistry = { list: () => records } as unknown as PluginRegistry;
    const { config } = settingsConfig(configured === undefined ? {} : { [SPEECH_PLUGIN_KEY]: configured });

    return new SpeechService(pluginRegistry, passthroughInvoker(), config, store, logger());
}

async function rejectionCode(promise: Promise<unknown>): Promise<PluginErrorCode> {
    const error = await promise.then(
        value => {
            throw new Error(`expected a rejection, got ${JSON.stringify(value)}`);
        },
        (thrown: unknown) => thrown,
    );
    expect(isPluginError(error), `expected a PluginError, got ${String(error)}`).toBe(true);
    return (error as PluginError).code;
}

describe('SpeechService.speak', () => {
    it('reads the stream and stores the audio under its checksum', async () => {
        const plugin = fakeSpeechPlugin({ chunks: [Buffer.from('half one '), Buffer.from('half two')] });
        const spoken = await service([plugin.record]).speak({ text: 'hello' });

        expect(spoken.ext).toBe('mp3');
        expect(spoken.pluginId).toBe('deadair.kokoro');
        expect(await readFile(join(root, spoken.checksum.slice(0, 2), `${spoken.checksum}.mp3`))).toEqual(Buffer.from('half one half two'));
    });

    it('reads a chunk at a time rather than asking for the whole thing', async () => {
        const plugin = fakeSpeechPlugin({ chunks: [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')] });

        await service([plugin.record]).speak({ text: 'hello' });

        // Three chunks plus the pull that finds the end. A long break is a sequence of buffers
        // here, never a file held whole.
        expect(plugin.pulls()).toBe(4);
    });

    it('passes the station voice through untouched, because only the plugin knows what it means', async () => {
        const plugin = fakeSpeechPlugin();

        await service([plugin.record]).speak({ text: 'hello', voice: 'newsreader' });

        expect(plugin.instance.speak).toHaveBeenCalledWith({ text: 'hello', voice: 'newsreader' });
    });

    it('needs no cleanup when it finishes normally, because a drained stream is already released', async () => {
        const plugin = fakeSpeechPlugin();

        await service([plugin.record]).speak({ text: 'hello' });

        // `cancel` on a stream that already ended is a no-op, which is what makes calling it from
        // a `finally` safe rather than merely tolerable.
        expect(plugin.wasCancelled()).toBe(false);
    });

    it('surfaces the plugin code when the engine hangs up mid-stream', async () => {
        const plugin = fakeSpeechPlugin({ streamError: new PluginError('the engine hung up').withCode('upstream') });

        // No cancel to assert here: a stream that errors has already released its own source, which
        // is why the `finally` can call cancel unconditionally without double-releasing anything.
        expect(await rejectionCode(service([plugin.record]).speak({ text: 'hello' }))).toBe('upstream');
    });

    it('cancels the stream when the store write fails, so a broken render does not hold a socket', async () => {
        const plugin = fakeSpeechPlugin();
        vi.spyOn(store, 'writeStream').mockRejectedValue(new PluginError('disk full').withCode('internal'));

        expect(await rejectionCode(service([plugin.record]).speak({ text: 'hello' }))).toBe('internal');
        // The stream is still live and nothing else knows about it: this is the only place that
        // can let the plugin's socket go.
        expect(plugin.wasCancelled()).toBe(true);
    });

    it('refuses a format the store cannot hold, and lets the stream go', async () => {
        const plugin = fakeSpeechPlugin({ mime: 'audio/aiff' });

        expect(await rejectionCode(service([plugin.record]).speak({ text: 'hello' }))).toBe('unsupported');
        // Cancelled before complaining, not after: the plugin has a socket open on our behalf and
        // nothing else will ever ask it to let go.
        expect(plugin.wasCancelled()).toBe(true);
    });

    it('reads a mime carrying parameters, because a server is entitled to send one', async () => {
        const plugin = fakeSpeechPlugin({ mime: 'audio/mpeg; charset=binary' });

        expect((await service([plugin.record]).speak({ text: 'hello' })).ext).toBe('mp3');
    });

    it('says nobody can speak rather than throwing something shapeless', async () => {
        expect(await rejectionCode(service([]).speak({ text: 'hello' }))).toBe('unavailable');
    });

    it('refuses to guess when several plugins can speak and the setting is unset', async () => {
        const first = fakeSpeechPlugin({ id: 'deadair.kokoro' });
        const second = fakeSpeechPlugin({ id: 'deadair.chatterbox' });

        expect(await rejectionCode(service([first.record, second.record]).speak({ text: 'hello' }))).toBe('unavailable');
    });

    it('uses the plugin the setting names when there are several', async () => {
        const kokoro = fakeSpeechPlugin({ id: 'deadair.kokoro' });
        const chatterbox = fakeSpeechPlugin({ id: 'deadair.chatterbox' });

        const spoken = await service([kokoro.record, chatterbox.record], 'deadair.chatterbox').speak({ text: 'hello' });

        expect(spoken.pluginId).toBe('deadair.chatterbox');
        expect(kokoro.instance.speak).not.toHaveBeenCalled();
    });

    it('follows the settings key the console writes, with no restart between', async () => {
        const kokoro = fakeSpeechPlugin({ id: 'deadair.kokoro' });
        const chatterbox = fakeSpeechPlugin({ id: 'deadair.chatterbox' });
        const station = settingsConfig({ [SPEECH_PLUGIN_KEY]: 'deadair.kokoro' });
        const speech = new SpeechService(
            { list: () => [kokoro.record, chatterbox.record] } as unknown as PluginRegistry,
            passthroughInvoker(),
            station.config,
            store,
            logger(),
        );

        expect((await speech.speak({ text: 'hello' })).pluginId).toBe('deadair.kokoro');

        // The operator changes the station's voice. The setting is a config layer, so the next
        // thing spoken uses the new speaker without this service being rebuilt or told.
        station.set(SPEECH_PLUGIN_KEY, 'deadair.chatterbox');

        expect((await speech.speak({ text: 'hello' })).pluginId).toBe('deadair.chatterbox');
    });
});

describe('SpeechService.speakers', () => {
    it('ignores a plugin that is not active, however well it is written', async () => {
        const plugin = fakeSpeechPlugin();
        (plugin.record as { status: string }).status = 'disabled';

        expect(service([plugin.record]).speakers()).toEqual([]);
    });
});

describe('SpeechService.voices', () => {
    it('asks a plugin that can list them', async () => {
        const plugin = fakeSpeechPlugin({ listVoices: true });
        const speech = service([plugin.record]);
        const speaker = speech.speakers()[0]!;

        expect(await speech.voices(speaker)).toEqual([{ id: 'host', label: 'Station host' }]);
    });

    it('answers an empty list for a plugin that cannot, because listing is optional', async () => {
        const plugin = fakeSpeechPlugin();
        const speech = service([plugin.record]);

        expect(await speech.voices(speech.speakers()[0]!)).toEqual([]);
    });
});
