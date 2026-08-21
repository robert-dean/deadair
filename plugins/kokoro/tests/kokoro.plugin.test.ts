import { describe, expect, it } from 'vitest';
import { isPluginError, type PluginError } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost, type RecordedFetchCall } from '@deadair/plugin-sdk/testing';

import { KokoroPlugin } from '../src/kokoro.plugin.js';

const BASE_URL = 'http://kokoro.test:8880/v1';

/** Voice rows as the host stores a `list` field: a JSON array of objects, in a string. */
const voiceRows = (...entries: Record<string, string>[]): string => JSON.stringify(entries);

/** Enough bytes to clear the "this is not audio" floor. */
const audioChunk = (size = 4096): Uint8Array => new Uint8Array(size).fill(7);

/** A body handed over in pieces, so a test can tell streaming from buffering. */
const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
        },
    });

interface FakeHostOptions {
    config?: Record<string, unknown>;
    apiKey?: string;
    /** Pieces the speech body arrives in, in order. */
    chunks?: Uint8Array[];
    /** Status the `/audio/speech` call answers with. */
    speakStatus?: number;
    fetchResponse?: Partial<{ status: number; body: string }>;
}

function fakeHost(options: FakeHostOptions = {}) {
    // Every body this fake hands out, so a test can assert the plugin let go of
    // one it was never going to read.
    const cancelled: string[] = [];

    const host: FakePluginHost = createFakePluginHost();

    host.setFetchImpl(async (url: string): Promise<Response> => {
        if (url.endsWith('/audio/speech')) {
            const status = options.speakStatus ?? 200;
            const ok = status >= 200 && status < 300;
            const response = new Response(ok ? streamOf(options.chunks ?? [audioChunk()]) : streamOf([Buffer.from('{"detail":"nope"}')]), {
                status,
            });

            // Wrapped so a test can assert the plugin let go of a body it was
            // never going to read, which is the only cleanup `speak` owns.
            const cancel = response.body!.cancel.bind(response.body);
            response.body!.cancel = async reason => {
                cancelled.push('speech');
                return cancel(reason);
            };

            return response;
        }

        return new Response(options.fetchResponse?.body ?? JSON.stringify({ voices: [{ id: 'af_heart' }] }), {
            status: options.fetchResponse?.status ?? 200,
        });
    });

    if (options.apiKey !== undefined) host.seedSecret('apiKey', options.apiKey);
    host.seedConfig({ baseUrl: BASE_URL, ...options.config });

    return { host, calls: host.calls, cancelled };
}

async function started(options: FakeHostOptions = {}) {
    const fake = fakeHost(options);
    const plugin = new KokoroPlugin();
    await plugin.init(fake.host);
    return { ...fake, plugin };
}

/** Reads a handle's audio the way the host does. */
async function drain(audio: ReadableStream<Uint8Array>): Promise<Buffer> {
    const parts: Buffer[] = [];
    for await (const chunk of audio) parts.push(Buffer.from(chunk));
    return Buffer.concat(parts);
}

/** The body of the `/audio/speech` call, parsed. */
const speechRequest = (calls: RecordedFetchCall[]): Record<string, unknown> => {
    const call = calls.find(candidate => candidate.url.endsWith('/audio/speech'));
    return JSON.parse(call?.body ?? '{}') as Record<string, unknown>;
};

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
    const error = await promise.then(
        value => {
            throw new Error(`expected a rejection, got ${JSON.stringify(value)}`);
        },
        (thrown: unknown) => thrown,
    );
    expect(isPluginError(error), `expected a PluginError, got ${String(error)}`).toBe(true);
    return (error as PluginError).code;
}

describe('KokoroPlugin.speak', () => {
    it('posts the script and hands back the engine body rather than the audio', async () => {
        const { plugin, calls } = await started();

        const handle = await plugin.speak({ text: 'You are listening to Deadair.' });

        const speech = calls.find(call => call.url.endsWith('/audio/speech'));
        expect(speech).toBeDefined();
        expect(speech!.url).toBe(`${BASE_URL}/audio/speech`);
        expect(speech!.method).toBe('POST');
        expect(speechRequest(calls)).toMatchObject({
            model: 'kokoro',
            input: 'You are listening to Deadair.',
            voice: 'af_heart',
            response_format: 'mp3',
        });
        expect(handle.mime).toBe('audio/mpeg');
        expect(handle.audio).toBeInstanceOf(ReadableStream);
    });

    it('answers with the media type it actually produced, not the one asked for', async () => {
        const { plugin } = await started({ config: { format: 'wav' } });

        // `SpeechRequest.format` is a hint; the configured format wins and the
        // mime reports the truth, because that header is what the station stores
        // the audio under and what every consumer decides from.
        const handle = await plugin.speak({ text: 'hello', format: 'nonsense' });

        expect(handle.mime).toBe('audio/wav');
        await handle.audio.cancel();
    });

    it('maps a station voice name to the engine voice the operator set', async () => {
        const { plugin, calls } = await started({
            config: { voices: voiceRows({ name: 'host', engine: 'af_bella' }, { name: 'newsreader', engine: 'am_michael' }) },
        });

        const handle = await plugin.speak({ text: 'hello', voice: 'newsreader' });

        expect(speechRequest(calls).voice).toBe('am_michael');
        await handle.audio.cancel();
    });

    it('sends the speed a voice was given, and sends none when it was given none', async () => {
        // Absent rather than 1: a request with no `speed` is the plainest thing this can ask for,
        // and it is what every voice asked for before the column existed.
        const config = { voices: voiceRows({ name: 'automaton', engine: 'am_echo', speed: '0.9' }, { name: 'host', engine: 'af_heart' }) };

        // Two starts rather than two speaks against one, because `speechRequest` reads the FIRST
        // speech call and a second assertion against the same recorder would re-read the first.
        const slow = await started({ config });
        const slowHandle = await slow.plugin.speak({ text: 'hello', voice: 'automaton' });
        expect(speechRequest(slow.calls).speed).toBe(0.9);
        await slowHandle.audio.cancel();

        const plain = await started({ config });
        const plainHandle = await plain.plugin.speak({ text: 'hello', voice: 'host' });
        expect(speechRequest(plain.calls)).not.toHaveProperty('speed');
        await plainHandle.audio.cancel();
    });

    it('passes a blend expression through untouched, because the engine takes one', async () => {
        const { plugin, calls } = await started({ config: { voices: voiceRows({ name: 'host', engine: 'af_bella(2)+af_sky(1)' }) } });

        const handle = await plugin.speak({ text: 'hello', voice: 'host' });

        expect(speechRequest(calls).voice).toBe('af_bella(2)+af_sky(1)');
        await handle.audio.cancel();
    });

    it('falls back to the default voice for a name it has no mapping for, and says so', async () => {
        const { plugin, calls, host } = await started({ config: { voices: voiceRows({ name: 'host', engine: 'af_bella' }), defaultVoice: 'af_heart' } });

        const handle = await plugin.speak({ text: 'hello', voice: 'renamed-persona' });

        // A station that says the wrong thing in the wrong voice is recoverable;
        // one that goes silent because a persona was renamed is not.
        expect(speechRequest(calls).voice).toBe('af_heart');
        expect(host.logger.warn).toHaveBeenCalled();
        await handle.audio.cancel();
    });

    it('refuses to try at all when no server has been configured', async () => {
        const { plugin } = await started({ config: { baseUrl: '   ' } });

        expect(await rejectionCode(plugin.speak({ text: 'hello' }))).toBe('config');
    });

    it('reports an authentication failure apart from any other refusal', async () => {
        const denied = await started({ speakStatus: 401 });
        const broken = await started({ speakStatus: 500 });

        expect(await rejectionCode(denied.plugin.speak({ text: 'hello' }))).toBe('auth');
        expect(await rejectionCode(broken.plugin.speak({ text: 'hello' }))).toBe('upstream');
    });

    it('lets go of the socket when the server refuses, since nothing will be reading it', async () => {
        const { plugin, cancelled } = await started({ speakStatus: 500 });

        // A refusal still carries a body, and `speak` throws instead of handing
        // it over, so this is the only place that can ever release it.
        await plugin.speak({ text: 'hello' }).catch(() => undefined);

        expect(cancelled).toEqual(['speech']);
    });
});

describe('KokoroPlugin audio stream', () => {
    it('forwards the body a piece at a time rather than buffering it', async () => {
        const { plugin } = await started({ chunks: [audioChunk(2048), audioChunk(2048)] });

        const handle = await plugin.speak({ text: 'hello' });
        const audio = await drain(handle.audio);

        expect(audio.byteLength).toBe(4096);
    });

    it('refuses a reply too small to be audio, which is how a JSON error page reaches the air', async () => {
        // v1 paid for this one: a 200 carrying a complaint about the voice becomes
        // a segment that airs as a click, and here is the only place to notice.
        const { plugin } = await started({ chunks: [Buffer.from('{"detail":"no such voice"}')] });

        const handle = await plugin.speak({ text: 'hello' });

        // The check is at the END of the stream on purpose: a server can dribble
        // a short error out in several pieces, so "was any of that audio" is
        // only answerable once it stops.
        expect(await rejectionCode(drain(handle.audio))).toBe('upstream');
    });

    it("has nothing to unwind on dispose, because the audio is the host's own body", async () => {
        const { plugin } = await started();
        const handle = await plugin.speak({ text: 'hello' });

        await expect(plugin.dispose()).resolves.toBeUndefined();
        await handle.audio.cancel();
    });
});

describe('KokoroPlugin.testConnection', () => {
    it('reports how many voices the server has', async () => {
        const { plugin } = await started();

        await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected. 1 voices available.' });
    });

    it('reports a server that answered with a failure', async () => {
        const { plugin } = await started({ fetchResponse: { status: 503 } });

        await expect(plugin.testConnection()).resolves.toEqual({ ok: false, message: 'Server answered HTTP 503.' });
    });

    it('accepts a server whose voice list is shaped differently, because it still speaks', async () => {
        const { plugin } = await started({ fetchResponse: { body: 'not json at all' } });

        await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected.' });
    });
});

describe('KokoroPlugin.listVoices', () => {
    it('lists the station names, not everything the engine can do', async () => {
        const { plugin } = await started({ config: { voices: voiceRows({ name: 'host', engine: 'af_bella' }), defaultVoice: 'af_heart' } });

        const voices = await plugin.listVoices();

        // A voice Kokoro has and the operator never named is not something the
        // station can ask for, so it is not offered.
        expect(voices.map(voice => voice.id)).toEqual(['', 'host']);
        expect(voices[0]!.description).toContain('af_heart');
        expect(voices[1]!.description).toContain('af_bella');
    });

    it('publishes a spec that changes with the mapping, which is what keys a cached preview', async () => {
        // Without it the host keys a sample on the STATION voice name, which is exactly the part
        // that does not change when an operator edits the mapping under it. See `SpeechVoice.spec`.
        const specFor = async (row: Record<string, string>): Promise<string | undefined> => {
            const { plugin } = await started({ config: { voices: voiceRows(row) } });
            return (await plugin.listVoices()).find(voice => voice.id === 'host')?.spec;
        };

        const bella = await specFor({ name: 'host', engine: 'af_bella' });

        expect(bella).not.toBe(await specFor({ name: 'host', engine: 'bm_george' }));
        expect(bella).not.toBe(await specFor({ name: 'host', engine: 'af_bella', speed: '1.2' }));
    });

    it('says the speed in the description only when there is one to say', async () => {
        const { plugin } = await started({
            config: { voices: voiceRows({ name: 'host', engine: 'af_bella' }, { name: 'automaton', engine: 'am_echo', speed: '0.9' }) },
        });

        const voices = await plugin.listVoices();

        expect(voices.find(voice => voice.id === 'host')!.description).not.toContain('x');
        expect(voices.find(voice => voice.id === 'automaton')!.description).toContain('0.9x');
    });
});

describe('KokoroPlugin.suggestConfigOptions', () => {
    it('offers what the server actually has, for the engine cell and the default voice', async () => {
        // The whole reason this exists: 68 voicepacks on the bundled server and a map holding the
        // empty string, because filling it in required knowing `af_heart` by heart.
        const { plugin } = await started({
            fetchResponse: { body: JSON.stringify({ voices: [{ id: 'af_heart' }, { id: 'bm_george' }] }) },
        });

        const suggested = await plugin.suggestConfigOptions();

        // Addressed as `<field>.<column>`, which is how the host publishes choices for one CELL of a
        // list rather than for the field.
        expect(suggested['voices.engine']).toEqual([
            { value: 'af_heart', label: 'af_heart' },
            { value: 'bm_george', label: 'bm_george' },
        ]);
        expect(suggested.defaultVoice).toEqual(suggested['voices.engine']);
    });

    it('reads a build that answers bare strings as well as one that answers objects', async () => {
        const { plugin } = await started({ fetchResponse: { body: JSON.stringify({ voices: ['af_heart', 'bm_george'] }) } });

        expect((await plugin.suggestConfigOptions())['voices.engine']?.map(option => option.value)).toEqual(['af_heart', 'bm_george']);
    });

    it('answers nothing rather than throwing when the server cannot be reached', async () => {
        // An operator fixing a bad address needs the form, and the refresh control is right there.
        const { plugin } = await started({ fetchResponse: { status: 502, body: 'nope' } });

        await expect(plugin.suggestConfigOptions()).resolves.toEqual({});
    });

    it('answers nothing for a body it cannot make sense of', async () => {
        const { plugin } = await started({ fetchResponse: { body: JSON.stringify({ voices: 'af_heart' }) } });

        await expect(plugin.suggestConfigOptions()).resolves.toEqual({});
    });
});
