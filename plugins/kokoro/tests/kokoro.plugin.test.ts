import { describe, expect, it } from 'vitest';
import { isPluginError, PluginError } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost, type RecordedFetchCall } from '@deadair/plugin-sdk/testing';

import { KokoroPlugin } from '../src/kokoro.plugin.js';

const BASE_URL = 'http://kokoro.test:8880/v1';

/** Voice rows as the host stores a `list` field: a JSON array of objects, in a string. */
const voiceRows = (...entries: Record<string, string>[]): string => JSON.stringify(entries);

/** What `host.fetch` throws when nothing is listening: the host's own wrapping of an undici reject. */
const unreachable = (): PluginError =>
    new PluginError(
        `plugin "deadair.kokoro" fetch to "kokoro.test" failed: fetch failed: connect ECONNREFUSED 127.0.0.1:8880 (ECONNREFUSED)`,
    ).withCode('upstream');

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
    /** Where the `/audio/speech` call says it landed, as the host reports a followed redirect. */
    speakRedirectedTo?: string;
    /** What a refused `/audio/speech` says. */
    speakBody?: string;
    fetchResponse?: Partial<{ status: number; body: string }>;
    /** Answers by the end of the URL, for a server whose endpoints do not all answer alike. */
    routes?: Record<string, { status?: number; body?: string }>;
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
            const response = new Response(
                ok ? streamOf(options.chunks ?? [audioChunk()]) : streamOf([Buffer.from(options.speakBody ?? '{"detail":"nope"}')]),
                {
                    status,
                },
            );

            if (options.speakRedirectedTo !== undefined) {
                Object.defineProperty(response, 'url', { value: options.speakRedirectedTo });
                Object.defineProperty(response, 'redirected', { value: true });
            }

            // Wrapped so a test can assert the plugin let go of a body it was
            // never going to read, which is the only cleanup `speak` owns.
            const cancel = response.body!.cancel.bind(response.body);
            response.body!.cancel = async reason => {
                cancelled.push('speech');
                return cancel(reason);
            };

            return response;
        }

        const route = Object.entries(options.routes ?? {}).find(([suffix]) => url.endsWith(suffix))?.[1];
        if (route !== undefined) return new Response(route.body ?? '', { status: route.status ?? 200 });

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
            response_format: 'flac',
        });
        expect(handle.mime).toBe('audio/flac');
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
        const config = { voices: voiceRows({ name: 'slowhost', engine: 'am_echo', speed: '0.9' }, { name: 'host', engine: 'af_heart' }) };

        // Two starts rather than two speaks against one, because `speechRequest` reads the FIRST
        // speech call and a second assertion against the same recorder would re-read the first.
        const slow = await started({ config });
        const slowHandle = await slow.plugin.speak({ text: 'hello', voice: 'slowhost' });
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
        const { plugin, calls, host } = await started({
            config: { voices: voiceRows({ name: 'host', engine: 'af_bella' }), defaultVoice: 'af_heart' },
        });

        const handle = await plugin.speak({ text: 'hello', voice: 'renamed-persona' });

        // A station that says the wrong thing in the wrong voice is recoverable;
        // one that goes silent because a persona was renamed is not.
        expect(speechRequest(calls).voice).toBe('af_heart');
        expect(host.logger.warn).toHaveBeenCalled();
        await handle.audio.cancel();
    });

    it('reads the shipped map when the config maps nothing, however it says so', async () => {
        // The four ways a station arrives with no rows, and they are one fact. Only the absent key
        // used to get the shipped voices, which made an ordinary save on this form — the console
        // submits every declared field — the way to collapse twenty characters onto one.
        for (const voices of [undefined, '[]', '   ', 'not json at all']) {
            const { plugin, calls } = await started({ config: voices === undefined ? {} : { voices } });

            const handle = await plugin.speak({ text: 'hello', voice: 'newsreader' });

            expect(speechRequest(calls).voice).toBe('bf_emma');
            await handle.audio.cancel();
        }
    });

    it('keeps the operator to their own map once they have filled one in', async () => {
        // The other half: rows that exist REPLACE the shipped ones rather than layering over them,
        // so a station mapping one voice has exactly one voice mapped and the rest fall to the
        // default. Otherwise clearing a row would silently restore the shipped pick behind it.
        const { plugin, calls } = await started({ config: { voices: voiceRows({ name: 'host', engine: 'af_bella' }), defaultVoice: 'af_heart' } });

        const handle = await plugin.speak({ text: 'hello', voice: 'newsreader' });

        expect(speechRequest(calls).voice).toBe('af_heart');
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

    it('names the address it was refused at, since that is the field to fix', async () => {
        const { plugin } = await started({ speakStatus: 405 });

        await expect(plugin.speak({ text: 'hello' })).rejects.toHaveProperty(
            'message',
            `kokoro answered HTTP 405 for voice "af_heart" at ${BASE_URL}/audio/speech`,
        );
    });

    it('says where a redirect took the request, because a redirect is how a POST becomes a 405', async () => {
        const landed = 'https://kokoro.test/v1/audio/speech';
        const { plugin } = await started({ speakStatus: 405, speakRedirectedTo: landed });

        await expect(plugin.speak({ text: 'hello' })).rejects.toThrow(`at ${BASE_URL}/audio/speech, after a redirect to ${landed} (`);
    });

    it('lets go of the socket when the server refuses, since nothing will be reading it', async () => {
        const { plugin, cancelled } = await started({ speakStatus: 500 });

        // A refusal still carries a body, and `speak` throws instead of handing
        // it over, so this is the only place that can ever release it.
        await plugin.speak({ text: 'hello' }).catch(() => undefined);

        expect(cancelled).toEqual(['speech']);
    });
});

describe('KokoroPlugin.speak refusals', () => {
    it('says what the server said was wrong, so a refused format is not blamed on the voice', async () => {
        const { plugin } = await started({
            speakStatus: 400,
            speakBody: JSON.stringify({ error: { message: 'unsupported response_format "flac"' } }),
        });

        await expect(plugin.speak({ text: 'hello' })).rejects.toHaveProperty(
            'message',
            `kokoro answered HTTP 400 for voice "af_heart" at ${BASE_URL}/audio/speech: unsupported response_format "flac"`,
        );
    });

    it.each([
        ['a bare error string', { error: 'voice not found' }],
        ['a bare detail string', { detail: 'voice not found' }],
        ['a detail object', { detail: { message: 'voice not found' } }],
    ])('reads %s', async (_shape, body) => {
        const { plugin } = await started({ speakStatus: 422, speakBody: JSON.stringify(body) });

        await expect(plugin.speak({ text: 'hello' })).rejects.toThrow(/: voice not found$/);
    });

    it('keeps the plain message when the refusal is not a sentence it can read', async () => {
        const { plugin } = await started({ speakStatus: 404, speakBody: '<html>not found</html>' });

        await expect(plugin.speak({ text: 'hello' })).rejects.toHaveProperty(
            'message',
            `kokoro answered HTTP 404 for voice "af_heart" at ${BASE_URL}/audio/speech`,
        );
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

    describe('against a server with no voice list', () => {
        const OLLAMA = 'http://ollama.test:11434/v1';
        const noVoices = { '/audio/voices': { status: 404 } };

        it('asks /models instead, because this same call is what lifts a quarantine', async () => {
            const { plugin } = await started({
                config: { model: 'tts-1' },
                routes: { ...noVoices, '/models': { body: JSON.stringify({ data: [{ id: 'tts-1' }] }) }, '/api/show': { status: 404 } },
            });

            await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected.' });
        });

        it("reports Ollama's voices for the configured model", async () => {
            const { plugin, calls } = await started({
                config: { baseUrl: OLLAMA, model: 'phonon:40m-de' },
                routes: {
                    ...noVoices,
                    '/models': { body: JSON.stringify({ data: [{ id: 'phonon:40m-de' }] }) },
                    '/api/show': { body: JSON.stringify({ voices: ['Greta', 'Lukas'] }) },
                },
            });

            await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected. 2 voices available.' });

            const show = calls.find(call => call.url === 'http://ollama.test:11434/api/show');
            expect(show?.method).toBe('POST');
            expect(JSON.parse(show?.body ?? '{}')).toEqual({ model: 'phonon:40m-de' });
        });

        it('matches a model Ollama lists under its :latest tag', async () => {
            const { plugin } = await started({
                config: { baseUrl: OLLAMA, model: 'phonon' },
                routes: {
                    ...noVoices,
                    '/models': { body: JSON.stringify({ data: [{ id: 'phonon:latest' }] }) },
                    '/api/show': { status: 200, body: '{}' },
                },
            });

            await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected.' });
        });

        it('says when the model is not listed, without failing a server that may still take it', async () => {
            const { plugin } = await started({
                config: { model: 'phonon' },
                routes: { ...noVoices, '/models': { body: JSON.stringify({ data: [{ id: 'gemma4:latest' }] }) } },
            });

            await expect(plugin.testConnection()).resolves.toEqual({
                ok: true,
                message: 'Connected, but this server does not list the model "phonon".',
            });
        });

        it('still connects when the voices cannot be read', async () => {
            const { plugin } = await started({
                config: { baseUrl: OLLAMA },
                routes: { ...noVoices, '/models': { body: JSON.stringify({ data: [{ id: 'kokoro' }] }) }, '/api/show': { status: 500 } },
            });

            await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected.' });
        });

        it.each([
            ['also answers 404', { status: 404 }],
            ['answers something other than a model list', { body: '<html>a web page</html>' }],
        ])('keeps the 404 when /models %s', async (_case, models) => {
            const { plugin } = await started({ routes: { ...noVoices, '/models': models } });

            await expect(plugin.testConnection()).resolves.toEqual({ ok: false, message: 'Server answered HTTP 404.' });
        });

        it('does not fall back on any other failure', async () => {
            const { plugin, calls } = await started({ routes: { '/audio/voices': { status: 401 }, '/models': { body: '{"data":[]}' } } });

            await expect(plugin.testConnection()).resolves.toEqual({ ok: false, message: 'Server answered HTTP 401.' });
            expect(calls.some(call => call.url.endsWith('/models'))).toBe(false);
        });
    });

    it('answers rather than throws when the server is not there, so the test button cannot quarantine it', async () => {
        // The whole of issue #179. The host records a rejection from a probe as a failed call, so
        // letting this one out meant three presses of Test connection against an engine that was
        // not running tripped the breaker -- and a quarantined speech plugin is one the render path
        // stops considering at all, which is the station losing its voice because somebody pressed
        // the button that asks whether it has one.
        const { plugin, host } = await started();
        host.setFetchImpl(async () => {
            throw unreachable();
        });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(false);
        // The address, because it is the field the operator has to fix and the one the host's own
        // error never carries: the port is exactly what is wrong in a compose-versus-host mixup.
        expect(result.message).toContain(BASE_URL);
        expect(result.message).toContain('ECONNREFUSED');
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
            config: { voices: voiceRows({ name: 'host', engine: 'af_bella' }, { name: 'slowhost', engine: 'am_echo', speed: '0.9' }) },
        });

        const voices = await plugin.listVoices();

        expect(voices.find(voice => voice.id === 'host')!.description).not.toContain('x');
        expect(voices.find(voice => voice.id === 'slowhost')!.description).toContain('0.9x');
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

    it("offers the configured model's voices on Ollama, which lists them on /api/show", async () => {
        const { plugin } = await started({
            config: { baseUrl: 'http://ollama.test:11434/v1', model: 'phonon:40m-de' },
            routes: { '/audio/voices': { status: 404 }, '/api/show': { body: JSON.stringify({ voices: ['Greta', 'Lukas'] }) } },
        });

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested['voices.engine']?.map(option => option.value)).toEqual(['Greta', 'Lukas']);
        expect(suggested.defaultVoice).toEqual(suggested['voices.engine']);
    });

    it('does not guess at /api/show when the address has no /v1 to sit beside', async () => {
        const { plugin, calls } = await started({
            routes: { '/audio/voices': { status: 404 } },
            config: { baseUrl: 'http://elsewhere.test/speech' },
        });

        await expect(plugin.suggestConfigOptions()).resolves.toEqual({});
        expect(calls.some(call => call.url.endsWith('/api/show'))).toBe(false);
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
