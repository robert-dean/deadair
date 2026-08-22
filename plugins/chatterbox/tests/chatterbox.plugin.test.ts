// Most of this engine behaves like the station's other speech plugin, and those cases are covered
// there. What is tested here is what differs: a model that has to be put on the GPU before anything
// can be said, and taken off it afterwards when the operator asked for that.

import { describe, expect, it } from 'vitest';
import { createFakePluginHost, type FakePluginHost, type RecordedFetchCall } from '@deadair/plugin-sdk/testing';

import { ChatterboxPlugin } from '../src/chatterbox.plugin.js';

const BASE_URL = 'http://gpu.test:8004/v1';

/** Voice rows as the host stores a `list` field: a JSON array of objects, in a string. */
const voiceRows = (...entries: Record<string, string>[]): string => JSON.stringify(entries);

/** Enough bytes to clear the "this is not audio" floor. */
const audioChunk = (size = 4096): Uint8Array => new Uint8Array(size).fill(7);

const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
        },
    });

interface FakeHostOptions {
    config?: Record<string, unknown>;
    chunks?: Uint8Array[];
    speakStatus?: number;
    /** What `/api/model-info` reports, one per call; the last repeats. */
    loaded?: boolean[];
    /** The rest of the model readout, for the connection message. */
    modelInfo?: Record<string, unknown>;
    /** What the predefined-voice list answers with. */
    predefined?: unknown;
    predefinedStatus?: number;
    /** Status for the OpenAI-shaped voice list, which is the fallback behind the named one. */
    voicesStatus?: number;
    /** What the server's schema declares `output_format` accepts. */
    formats?: string[];
    /** Status for `/openapi.json`. 404 is a server built with its schema switched off. */
    openapiStatus?: number;
}

/**
 * As much of a FastAPI schema document as the plugin reads, with the accepted formats in it.
 *
 * The `anyOf` around the enum is the real shape and not padding: `output_format` is optional on the
 * native endpoint, so it generates as a union with `null` where the OpenAI arm's `response_format`
 * was a bare enum. A reader that only understands the bare form answers nothing here and the form
 * silently falls back to the manifest's superset, which is a save the server then refuses.
 */
const openApiDocument = (formats: string[]): unknown => ({
    paths: {
        '/tts': {
            post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomTTSRequest' } } } } },
        },
    },
    components: { schemas: { CustomTTSRequest: { properties: { output_format: { anyOf: [{ enum: formats }, { type: 'null' }] } } } } },
});

function fakeHost(options: FakeHostOptions = {}) {
    const loadedAnswers = [...(options.loaded ?? [true])];
    const next = <T>(queue: T[]): T => (queue.length > 1 ? queue.shift()! : queue[0]!);

    const host: FakePluginHost = createFakePluginHost();

    host.setFetchImpl(async (url: string): Promise<Response> => {
        if (url.endsWith('/tts')) {
            const status = options.speakStatus ?? 200;
            const ok = status >= 200 && status < 300;
            return new Response(ok ? streamOf(options.chunks ?? [audioChunk()]) : streamOf([Buffer.from('{"detail":"nope"}')]), { status });
        }
        if (url.endsWith('/api/model-info')) {
            return new Response(JSON.stringify({ ...options.modelInfo, loaded: next(loadedAnswers) }), { status: 200 });
        }
        if (url.endsWith('/openapi.json')) {
            const status = options.openapiStatus ?? 200;
            return new Response(status === 200 ? JSON.stringify(openApiDocument(options.formats ?? ['wav', 'opus', 'mp3'])) : '{}', { status });
        }
        if (url.endsWith('/restart_server')) return new Response('{}', { status: 200 });
        if (url.endsWith('/api/unload')) return new Response('{}', { status: 200 });
        if (url.endsWith('/get_predefined_voices')) {
            return new Response(JSON.stringify(options.predefined ?? [{ filename: 'Olivia.wav', display_name: 'Olivia' }]), {
                status: options.predefinedStatus ?? 200,
            });
        }
        if (url.endsWith('/audio/voices')) {
            return new Response(JSON.stringify({ voices: ['Michael.wav'] }), { status: options.voicesStatus ?? 200 });
        }

        throw new Error(`unexpected url ${url}`);
    });

    host.seedConfig({ baseUrl: BASE_URL, ...options.config });

    return { host, calls: host.calls };
}

async function started(options: FakeHostOptions = {}) {
    const fake = fakeHost(options);
    const plugin = new ChatterboxPlugin();
    await plugin.init(fake.host);
    return { ...fake, plugin };
}

/** Every url this plugin reached, in order, as a short name. */
const reached = (calls: RecordedFetchCall[]): string[] =>
    calls.map(call => {
        if (call.url.endsWith('/tts')) return 'speak';
        if (call.url.endsWith('/api/model-info')) return 'info';
        if (call.url.endsWith('/restart_server')) return 'load';
        if (call.url.endsWith('/api/unload')) return 'unload';
        return call.url;
    });

const speechRequest = (calls: RecordedFetchCall[]): Record<string, unknown> => {
    const call = calls.find(candidate => candidate.url.endsWith('/tts'));
    return JSON.parse(call?.body ?? '{}') as Record<string, unknown>;
};

/** Read a handle's audio to the end, which is what the host does. */
const drain = async (audio: ReadableStream<Uint8Array>): Promise<number> => {
    const reader = audio.getReader();
    let bytes = 0;
    for (;;) {
        const next = await reader.read();
        if (next.done) return bytes;
        bytes += next.value.byteLength;
    }
};

describe('ChatterboxPlugin.speak', () => {
    it('makes sure there is a model before asking for audio', async () => {
        // This engine does not reload itself, so a previous render's unload leaves the server
        // answering 503 until something asks for a model back.
        const { plugin, calls } = await started({ loaded: [false, true] });

        const handle = await plugin.speak({ text: 'hello' });
        await drain(handle.audio);

        expect(reached(calls).slice(0, 3)).toEqual(['info', 'load', 'info']);
        expect(reached(calls)).toContain('speak');
    });

    it('costs one question when a model is already resident', async () => {
        const { plugin, calls } = await started({ loaded: [true] });

        const handle = await plugin.speak({ text: 'hello' });
        await drain(handle.audio);

        expect(reached(calls)).toEqual(['info', 'speak']);
    });

    it('maps a station voice name to the clip the operator chose, and sends its speed', async () => {
        const { plugin, calls } = await started({
            config: { voices: voiceRows({ name: 'newsreader', engine: 'Michael.wav', speed: '0.9' }) },
        });

        const handle = await plugin.speak({ text: 'hello', voice: 'newsreader' });
        await drain(handle.audio);

        expect(speechRequest(calls).predefined_voice_id).toBe('Michael.wav');
        expect(speechRequest(calls).speed_factor).toBe(0.9);
    });

    // The endpoint this now posts to is the one carrying the engine's expressiveness dials, and
    // reaching them is the whole reason for being here. Sending one is a separate decision with a
    // contract change behind it — a dial belongs either on a voice or on a request, and moving the
    // transport must not answer that by accident. So the absence is pinned rather than assumed.
    it('sends no expressiveness dial, because where one belongs is not decided here', async () => {
        const { plugin, calls } = await started({
            config: { voices: voiceRows({ name: 'host', engine: 'Olivia.wav' }) },
        });

        const handle = await plugin.speak({ text: 'hello', voice: 'host' });
        await drain(handle.audio);

        const body = speechRequest(calls);
        for (const dial of ['exaggeration', 'cfg_weight', 'temperature', 'seed']) {
            expect(body, `${dial} reached the engine`).not.toHaveProperty(dial);
        }
    });

    // A predefined clip, never an uploaded reference. `clone` is a second way to name a voice and
    // belongs beside the clip in the mapping table if it is ever wanted.
    it('asks for a predefined clip rather than a cloned reference', async () => {
        const { plugin, calls } = await started();

        const handle = await plugin.speak({ text: 'hello' });
        await drain(handle.audio);

        expect(speechRequest(calls).voice_mode).toBe('predefined');
        expect(speechRequest(calls)).not.toHaveProperty('reference_audio_filename');
    });

    // The streaming arm always answers WAV whatever `output_format` said, and the body is handed
    // back as a stream either way, so asking for it would trade the operator's format for nothing.
    it('does not ask the server to stream, so the chosen format survives', async () => {
        const { plugin, calls } = await started({ config: { format: 'opus' } });

        const handle = await plugin.speak({ text: 'hello' });
        await drain(handle.audio);

        expect(speechRequest(calls).stream).toBe(false);
        expect(speechRequest(calls).output_format).toBe('opus');
    });

    it('falls back to the default clip for a name it has no mapping for, and says so', async () => {
        const { plugin, host, calls } = await started({ config: { defaultVoice: 'Olivia.wav' } });

        const handle = await plugin.speak({ text: 'hello', voice: 'renamed-persona' });
        await drain(handle.audio);

        expect(speechRequest(calls).predefined_voice_id).toBe('Olivia.wav');
        expect(host.logger.warn).toHaveBeenCalled();
    });

    it('reads the shipped map when the config maps nothing, however it says so', async () => {
        // Measured on the live station, which is why this is here rather than only next door: the
        // stored row held `"voices":"[]"` and every character fell to a `defaultVoice` of `Axel` —
        // a bare name where the clips are filenames, so the server answered 404 and every break
        // went to the floor. An empty table is an unfilled one, not an instruction.
        for (const voices of [undefined, '[]', '   ', 'not json at all']) {
            const { plugin, calls } = await started({ config: voices === undefined ? {} : { voices } });

            const handle = await plugin.speak({ text: 'hello', voice: 'newsreader' });
            await drain(handle.audio);

            expect(speechRequest(calls).predefined_voice_id).toBe('Abigail.wav');
        }
    });

    it('keeps the operator to their own map once they have filled one in', async () => {
        const { plugin, calls } = await started({
            config: { voices: voiceRows({ name: 'host', engine: 'Olivia.wav' }), defaultVoice: 'Miles.wav' },
        });

        const handle = await plugin.speak({ text: 'hello', voice: 'newsreader' });
        await drain(handle.audio);

        expect(speechRequest(calls).predefined_voice_id).toBe('Miles.wav');
    });
});

describe('freeing the GPU between breaks', () => {
    it('holds the model by default, because the trade only pays on a contended card', async () => {
        // An unload reclaims roughly 70% of what the model held and costs a load before the next
        // break, so it is offered rather than assumed.
        const { plugin, calls } = await started();

        const handle = await plugin.speak({ text: 'hello' });
        await drain(handle.audio);

        expect(reached(calls)).not.toContain('unload');
    });

    it('drops the model once the host has finished reading, not when speak returns', async () => {
        // `speak` comes back long before the audio does, so unloading there would pull the model out
        // from under the synthesis it just started. Only the stream knows when the reading stopped.
        const { plugin, calls } = await started({ config: { unloadAfterRender: true } });

        const handle = await plugin.speak({ text: 'hello' });
        expect(reached(calls)).not.toContain('unload');

        await drain(handle.audio);
        expect(reached(calls)).toContain('unload');
    });

    it('drops the model when the host cancels the body instead of reading it', async () => {
        // A card held after an abandoned render is held for exactly as long as one held after a
        // successful render.
        const { plugin, calls } = await started({ config: { unloadAfterRender: true } });

        const handle = await plugin.speak({ text: 'hello' });
        await handle.audio.cancel();

        expect(reached(calls)).toContain('unload');
    });

    it('drops the model when what came back was not audio', async () => {
        // The failure is about the bytes, not about whether the GPU should still be held.
        const { plugin, calls } = await started({ config: { unloadAfterRender: true }, chunks: [new Uint8Array(8)] });

        const handle = await plugin.speak({ text: 'hello' });
        await expect(drain(handle.audio)).rejects.toThrow();

        expect(reached(calls)).toContain('unload');
    });

    it('drops it exactly once, however the stream ends', async () => {
        // A cancel following an error would otherwise unload twice, and the second one races the
        // next break's load.
        const { plugin, calls } = await started({ config: { unloadAfterRender: true }, chunks: [new Uint8Array(8)] });

        const handle = await plugin.speak({ text: 'hello' });
        await expect(drain(handle.audio)).rejects.toThrow();
        await handle.audio.cancel().catch(() => {});

        expect(reached(calls).filter(call => call === 'unload')).toHaveLength(1);
    });

    it('reads a hand-edited "false" as off, not as a truthy string', async () => {
        // Plugin config is jsonb so a checkbox arrives as a real boolean, but a row edited in psql
        // is the trap that cost six of the station's own settings before `settingIsOn` existed.
        const { plugin, calls } = await started({ config: { unloadAfterRender: 'false' } });

        const handle = await plugin.speak({ text: 'hello' });
        await drain(handle.audio);

        expect(reached(calls)).not.toContain('unload');
    });
});

describe('ChatterboxPlugin.suggestConfigOptions', () => {
    it('offers the clip as the value and its name as the label', async () => {
        // The filename is what the request needs; the name is what a person is choosing between.
        const { plugin } = await started();

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested['voices.engine']).toEqual([{ value: 'Olivia.wav', label: 'Olivia' }]);
        expect(suggested.defaultVoice).toEqual(suggested['voices.engine']);
    });

    it('falls back to the plainer list for a build that does not serve the named one', async () => {
        const { plugin } = await started({ predefinedStatus: 404 });

        expect((await plugin.suggestConfigOptions())['voices.engine']).toEqual([{ value: 'Michael.wav', label: 'Michael.wav' }]);
    });

    it('answers nothing rather than throwing when the server cannot be reached', async () => {
        const { plugin, host } = await started();
        host.setFetchImpl(async () => {
            throw new Error('connection refused');
        });

        await expect(plugin.suggestConfigOptions()).resolves.toEqual({});
    });

    it('offers the formats the server says it accepts, not the ones this plugin knows about', async () => {
        // No endpoint answers this; the accepted values are written down in the server's own
        // schema and nowhere else. Offering the manifest's list instead is how `flac` sat in the
        // dropdown answering 422 to every break rendered under it.
        const { plugin } = await started({ formats: ['wav', 'mp3'] });

        expect((await plugin.suggestConfigOptions()).format).toEqual([
            { value: 'wav', label: 'wav' },
            { value: 'mp3', label: 'mp3' },
        ]);
    });

    it('drops a format it has no mime type for, because the station could not store one', async () => {
        // The MIME is the half the server never reports, and `configSchema` would refuse the save
        // anyway — so offering it would be offering a choice that cannot be kept.
        const { plugin } = await started({ formats: ['mp3', 'aac'] });

        expect((await plugin.suggestConfigOptions()).format).toEqual([{ value: 'mp3', label: 'mp3' }]);
    });

    it('leaves the format alone when the server publishes no schema', async () => {
        // The manifest's own list stands, which is why it is kept honest rather than generous.
        const { plugin } = await started({ openapiStatus: 404 });

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested.format).toBeUndefined();
        expect(suggested['voices.engine']).toHaveLength(1);
    });

    it('still offers the formats when neither voice list can be read', async () => {
        // Two different endpoints, gathered independently: one failing must not cost the form the
        // other, because a build serving one and not the other is an ordinary state.
        const { plugin } = await started({ predefinedStatus: 500, voicesStatus: 500 });

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested.format).toHaveLength(3);
        expect(suggested['voices.engine']).toBeUndefined();
    });
});

describe('ChatterboxPlugin.listVoices', () => {
    it('lists the station names and always offers the fallback', async () => {
        const { plugin } = await started({
            config: { voices: voiceRows({ name: 'host', engine: 'Olivia.wav' }), defaultVoice: 'Michael.wav' },
        });

        const voices = await plugin.listVoices();

        expect(voices.map(voice => voice.id)).toEqual(['', 'host']);
        expect(voices[0]!.description).toContain('Michael.wav');
    });

    it('publishes a spec that changes with the mapping, which is what keys a cached preview', async () => {
        const specFor = async (row: Record<string, string>): Promise<string | undefined> => {
            const { plugin } = await started({ config: { voices: voiceRows(row) } });
            return (await plugin.listVoices()).find(voice => voice.id === 'host')?.spec;
        };

        const plain = await specFor({ name: 'host', engine: 'Olivia.wav' });

        expect(plain).not.toBe(await specFor({ name: 'host', engine: 'Michael.wav' }));
        expect(plain).not.toBe(await specFor({ name: 'host', engine: 'Olivia.wav', speed: '1.2' }));
    });
});

describe('ChatterboxPlugin.testConnection', () => {
    it('says whether a model is resident, which is the thing an operator cannot see', async () => {
        expect((await (await started({ loaded: [true] })).plugin.testConnection()).message).toContain('A model is loaded');
        expect((await (await started({ loaded: [false] })).plugin.testConnection()).message).toContain('No model is loaded');
    });

    it('names the model and the device, because there is nowhere else that can', async () => {
        // The settings form is drawn from a static manifest, so the note where the model field
        // used to be cannot carry this. This message is the whole of the live readout.
        const { plugin } = await started({ loaded: [true], modelInfo: { class_name: 'ChatterboxTurboTTS', type: 'turbo', device: 'cuda' } });

        expect((await plugin.testConnection()).message).toContain('Loaded: ChatterboxTurboTTS on cuda.');
    });

    it('falls back to the type when the server names no class', async () => {
        const { plugin } = await started({ loaded: [true], modelInfo: { type: 'turbo', device: 'cpu' } });

        expect((await plugin.testConnection()).message).toContain('Loaded: turbo on cpu.');
    });

    it('does not claim there is no model when the server would not say', async () => {
        // A readout that never came back is not a server holding nothing, and "no model is loaded"
        // is a confident sentence about the one thing the operator opened this to find out.
        const { plugin, host } = await started();
        host.setFetchImpl(async (url: string) => {
            if (url.endsWith('/api/model-info')) throw new Error('connection refused');
            return new Response(JSON.stringify({ voices: ['Michael.wav'] }), { status: 200 });
        });

        const { message } = await plugin.testConnection();

        expect(message).toContain('would not say');
        expect(message).not.toContain('No model is loaded');
    });

    it('refuses without a server URL rather than guessing one', async () => {
        const fake = fakeHost();
        fake.host.seedConfig({ baseUrl: '' });
        const plugin = new ChatterboxPlugin();
        await plugin.init(fake.host);

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false });
    });
});

describe('teardown', () => {
    it('puts the model back on unload when the operator asked for that', async () => {
        // An operator reloading the plugin, or the API shutting down mid-hour, is exactly when a
        // held card is least excusable.
        const { plugin, calls } = await started({ config: { unloadAfterRender: true } });

        await plugin.dispose();

        expect(reached(calls)).toContain('unload');
    });

    it('leaves the model alone on unload when it was never asked to drop it', async () => {
        const { plugin, calls } = await started();

        await plugin.dispose();

        expect(reached(calls)).not.toContain('unload');
    });
});

// A guard rather than a test of behaviour: the manifest is what the console renders and what the
// host validates against, so a field that stops matching what `onLoad` reads is a silent misread.
describe('the manifest and the plugin agree', () => {
    it('declares every config key the plugin reads', async () => {
        const { chatterboxManifest } = await import('../src/chatterbox.manifest.js');
        const declared = new Set(chatterboxManifest.configFields?.map(field => field.key));

        for (const key of ['baseUrl', 'apiKey', 'format', 'defaultVoice', 'voices', 'unloadAfterRender']) {
            expect(declared.has(key), `${key} is read but not declared`).toBe(true);
        }
    });

    it('asks for no model, because there is nothing to ask', async () => {
        // One model at a time, named by the server's own config, with no endpoint listing any
        // others. A field here would be a box that looks like a choice and changes nothing.
        const { chatterboxManifest } = await import('../src/chatterbox.manifest.js');
        const declared = chatterboxManifest.configFields ?? [];

        expect(declared.find(field => field.key === 'model')).toBeUndefined();
        expect(declared.find(field => field.key === 'modelNote')?.type).toBe('note');
    });

    it('offers no format it could not store', async () => {
        // The static list is what a form drawn against an unreachable server shows, so it has to
        // be the honest one: `flac` was in it and answered 422 on the engine's own schema.
        const { chatterboxManifest, RESPONSE_FORMATS } = await import('../src/chatterbox.manifest.js');
        const offered = chatterboxManifest.configFields?.find(field => field.key === 'format')?.options ?? [];

        expect(offered.map(option => option.value)).toEqual(Object.keys(RESPONSE_FORMATS));
        expect(offered.map(option => option.value)).not.toContain('flac');
    });
});
