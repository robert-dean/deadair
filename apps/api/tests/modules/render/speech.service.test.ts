// The claim under test is that the audio never exists whole in this process: `speak` hands back a
// handle, the service drains it a chunk at a time, and the chunks go into a store that hashes as it
// writes. The fake plugin here therefore counts what it was asked for, rather than handing over a
// buffer and letting the assertions be about its contents alone.

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginError, isPluginError, type PluginErrorCode, type SpeechPluginInstance } from '@deadair/plugin-sdk';

import type { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import type { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import type { SettingsRepository } from '../../../src/modules/settings/settings.repository.js';
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
    /** What each `readStream` hands over, in order. */
    chunks?: Buffer[];
    speakError?: PluginError;
    listVoices?: boolean;
}

function fakeSpeechPlugin(options: FakePluginOptions = {}) {
    const id = options.id ?? 'deadair.kokoro';
    const chunks = options.chunks ?? [Buffer.from('some audio bytes')];
    const closed: string[] = [];
    let cursor = 0;
    let seq = 0;

    const instance = {
        speak: vi.fn(async () => {
            if (options.speakError) throw options.speakError;
            return { streamId: 'plugin-1', mime: options.mime ?? 'audio/mpeg' };
        }),
        readStream: vi.fn(async (streamId: string) => {
            if (streamId !== 'plugin-1') throw new PluginError('no such stream').withCode('not_found');
            if (cursor >= chunks.length) return { seq: seq++, done: true };
            return { seq: seq++, data: chunks[cursor++]!.toString('base64'), done: false };
        }),
        closeStream: vi.fn(async (streamId: string) => {
            closed.push(streamId);
        }),
        ...(options.listVoices ? { listVoices: vi.fn(async () => [{ id: 'host', label: 'Station host' }]) } : {}),
    } as unknown as SpeechPluginInstance;

    const record = { id, status: 'active', manifest: { capabilities: ['speech'] }, instance } as unknown as PluginRecord;

    return { record, instance, closed };
}

function service(records: PluginRecord[], configured?: string) {
    const pluginRegistry = { list: () => records } as unknown as PluginRegistry;
    const settings = { get: vi.fn(async () => configured) } as unknown as SettingsRepository;

    return new SpeechService(pluginRegistry, passthroughInvoker(), settings, store, logger());
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
    it('drains the handle and stores the audio under its checksum', async () => {
        const plugin = fakeSpeechPlugin({ chunks: [Buffer.from('half one '), Buffer.from('half two')] });
        const spoken = await service([plugin.record]).speak({ text: 'hello' });

        expect(spoken.ext).toBe('mp3');
        expect(spoken.pluginId).toBe('deadair.kokoro');
        expect(await readFile(join(root, spoken.checksum.slice(0, 2), `${spoken.checksum}.mp3`))).toEqual(Buffer.from('half one half two'));
    });

    it('reads a chunk at a time rather than asking for the whole thing', async () => {
        const plugin = fakeSpeechPlugin({ chunks: [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')] });

        await service([plugin.record]).speak({ text: 'hello' });

        // Three chunks plus the terminal read. This is the difference the byte protocol bought: a
        // long break is a sequence of buffers here, never a file held whole.
        expect(plugin.instance.readStream).toHaveBeenCalledTimes(4);
    });

    it('passes the station voice through untouched, because only the plugin knows what it means', async () => {
        const plugin = fakeSpeechPlugin();

        await service([plugin.record]).speak({ text: 'hello', voice: 'newsreader' });

        expect(plugin.instance.speak).toHaveBeenCalledWith({ text: 'hello', voice: 'newsreader' });
    });

    it('closes the stream when it finishes normally', async () => {
        const plugin = fakeSpeechPlugin();

        await service([plugin.record]).speak({ text: 'hello' });

        expect(plugin.closed).toEqual(['plugin-1']);
    });

    it('closes the stream when draining fails, so a broken render does not hold a socket', async () => {
        const plugin = fakeSpeechPlugin();
        plugin.instance.readStream = vi.fn(async () => {
            throw new PluginError('the engine hung up').withCode('upstream');
        });

        expect(await rejectionCode(service([plugin.record]).speak({ text: 'hello' }))).toBe('upstream');
        expect(plugin.closed).toEqual(['plugin-1']);
    });

    it('refuses a format the store cannot hold, and lets the stream go', async () => {
        const plugin = fakeSpeechPlugin({ mime: 'audio/aiff' });

        expect(await rejectionCode(service([plugin.record]).speak({ text: 'hello' }))).toBe('unsupported');
        // Complained about after closing, not before: the plugin has a socket open on our behalf
        // and nothing else will ever ask it to let go.
        expect(plugin.closed).toEqual(['plugin-1']);
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

    it('reads the choice from the settings key the console writes', async () => {
        const plugin = fakeSpeechPlugin();
        const settings = { get: vi.fn(async () => undefined) } as unknown as SettingsRepository;
        const speech = new SpeechService(
            { list: () => [plugin.record] } as unknown as PluginRegistry,
            passthroughInvoker(),
            settings,
            store,
            logger(),
        );

        await speech.speak({ text: 'hello' });

        expect(settings.get).toHaveBeenCalledWith(SPEECH_PLUGIN_KEY);
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
