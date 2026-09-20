import { describe, expect, it } from 'vitest';
import { isPluginError, type PluginError, type SpeechRequest } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';
import type { Capabilities, CoreHealth, EngineSummary, Variant, Voice } from '@maroonedsoftware/rhapsode-sdk';

import { mimeOf, RhapsodePlugin } from '../src/rhapsode.plugin.js';

const BASE_URL = 'http://rhapsode.test:8080';

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
    /** Pieces the speech body arrives in, in order. */
    chunks?: Uint8Array[];
    /** Status `/speak` answers with. */
    speakStatus?: number;
    /** What `/speak` answers with instead of audio, for a refusal. */
    speakBody?: string;
    /** The content type the audio is announced as. */
    contentType?: string;
    /** What each engine says it can do. An engine not named here is one the server will not describe. */
    capabilities?: Record<string, Capabilities>;
    /** What `/health` answers, for the console's Test connection. */
    health?: CoreHealth;
    /** Status `/health` answers with instead, or a transport failure. */
    healthStatus?: number;
    healthThrows?: boolean;
    /** What `/engines` lists, and the status it answers with. */
    engines?: EngineSummary[];
    enginesStatus?: number;
    /** What each engine lists as its voices. */
    voices?: Record<string, Voice[]>;
}

/** A licence pair, since every engine summary carries one and none of these tests is about it. */
const MIT = { code: 'MIT', weights: 'MIT', weightsCommercialUse: true };

/** A JSON reply, the way this server sends one. */
const answering = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** One engine's document, with only the parts these tests look at filled in. */
const capabilities = (over: Partial<Capabilities> = {}): Capabilities => ({
    contract: 1,
    engine: { id: 'kokoro', displayName: 'Kokoro', adapterVersion: '0.1.0' },
    license: { code: 'MIT', weights: 'MIT', weightsCommercialUse: true },
    device: { type: 'cpu', name: 'a laptop' },
    variants: { only: { cues: [], deliveries: [], dials: {} } },
    formats: ['wav'],
    ...over,
});

/** A build, for a document's `variants` table. */
const variant = (over: Partial<Variant> = {}): Variant => ({ cues: [], deliveries: [], dials: {}, ...over });

function fakeHost(options: FakeHostOptions = {}) {
    // Every body this fake hands out that was let go rather than read, so a test can assert the
    // plugin did not leave a socket open.
    const cancelled: string[] = [];

    const host: FakePluginHost = createFakePluginHost();

    host.setFetchImpl(async (url: string): Promise<Response> => {
        if (url.endsWith('/health')) {
            if (options.healthThrows === true) throw new Error('connect ECONNREFUSED');

            return options.healthStatus !== undefined && options.healthStatus !== 200
                ? answering({ error: { code: 'internal', message: 'no' } }, options.healthStatus)
                : answering(options.health ?? { contract: 1, status: 'ok', engines: [], residency: { resident: 0, max: 1, waiting: 0 } });
        }

        if (url.endsWith('/engines')) {
            return options.enginesStatus !== undefined && options.enginesStatus !== 200
                ? answering({ error: { code: 'internal', message: 'no' } }, options.enginesStatus)
                : answering(options.engines ?? []);
        }

        const listing = /\/engines\/([^/]+)\/voices$/.exec(url);
        if (listing !== null) {
            const held = options.voices?.[decodeURIComponent(listing[1]!)];

            return held === undefined ? answering({ error: { code: 'unknown_engine', message: 'no' } }, 404) : answering(held);
        }

        const asked = /\/engines\/([^/]+)\/capabilities$/.exec(url);
        if (asked !== null) {
            const document = options.capabilities?.[decodeURIComponent(asked[1]!)];

            return document === undefined ? answering({ error: { code: 'unknown_engine', message: 'no such engine' } }, 404) : answering(document);
        }

        if (!url.endsWith('/speak')) throw new Error(`nothing in this test should call ${url}`);

        const status = options.speakStatus ?? 200;
        const ok = status >= 200 && status < 300;
        const response = new Response(
            ok
                ? streamOf(options.chunks ?? [audioChunk()])
                : streamOf([Buffer.from(options.speakBody ?? '{"error":{"code":"internal","message":"nope"}}')]),
            { status, headers: ok ? { 'content-type': options.contentType ?? 'audio/mpeg' } : { 'content-type': 'application/json' } },
        );

        const cancel = response.body!.cancel.bind(response.body);
        response.body!.cancel = async reason => {
            cancelled.push('speech');
            return cancel(reason);
        };

        return response;
    });

    host.seedConfig({ baseUrl: BASE_URL, ...options.config });

    return { host, calls: host.calls, cancelled };
}

async function started(options: FakeHostOptions = {}) {
    const fake = fakeHost(options);
    const plugin = new RhapsodePlugin();
    await plugin.init(fake.host);

    return { ...fake, plugin };
}

/** The one `/speak` body this test made, as the object it was sent as. */
const sentBody = (calls: { url: string; body: string | undefined }[]): Record<string, unknown> => {
    const call = calls.find(entry => entry.url.endsWith('/speak'));
    expect(call, 'nothing was posted to /speak').toBeDefined();

    return JSON.parse(call!.body ?? '{}') as Record<string, unknown>;
};

/** Read a handle to the end, which is where the plausibility check fires. */
const drain = async (audio: ReadableStream<Uint8Array>): Promise<number> => {
    let total = 0;
    for await (const chunk of audio as unknown as AsyncIterable<Uint8Array>) total += chunk.byteLength;

    return total;
};

const say = (over: Partial<SpeechRequest> = {}): SpeechRequest => ({ text: 'Good evening.', ...over });

describe('speak', () => {
    it('posts one line to /speak on the configured server', async () => {
        const { plugin, calls } = await started();

        await plugin.speak(say());

        const posted = calls.find(call => call.url.endsWith('/speak'));
        expect(posted?.url).toBe(`${BASE_URL}/speak`);
        expect(posted?.method).toBe('POST');
        expect(sentBody(calls)).toEqual({ engine: 'kokoro', text: 'Good evening.', format: 'mp3', stream: true });
    });

    it('asks for no particular voice when nothing is mapped and no default is set', async () => {
        // An absent `voice` is a thing this server understands: it means the engine's own default.
        const { plugin, calls } = await started();

        await plugin.speak(say({ voice: undefined }));

        expect(sentBody(calls)).not.toHaveProperty('voice');
    });

    it('sends the engine, voice and variant a mapped row names', async () => {
        const { plugin, calls } = await started({
            config: { voices: voiceRows({ name: 'host', engine: 'chatterbox', voice: 'gravel', variant: 'turbo' }) },
        });

        await plugin.speak(say({ voice: 'host' }));

        expect(sentBody(calls)).toMatchObject({ engine: 'chatterbox', voice: 'gravel', variant: 'turbo' });
    });

    it('speaks a row that names no engine with the default one', async () => {
        const { plugin, calls } = await started({
            config: { defaultEngine: 'orpheus', voices: voiceRows({ name: 'host', voice: 'tara' }) },
        });

        await plugin.speak(say({ voice: 'host' }));

        expect(sentBody(calls)).toMatchObject({ engine: 'orpheus', voice: 'tara' });
    });

    it('lets each half fall back on its own', async () => {
        // A row naming an engine and a voice takes the default VARIANT, because the two questions
        // are answered in different places and neither is a package deal.
        const { plugin, calls } = await started({
            config: { defaultVariant: 'fp16', voices: voiceRows({ name: 'host', engine: 'kokoro', voice: 'af_heart' }) },
        });

        await plugin.speak(say({ voice: 'host' }));

        expect(sentBody(calls)).toMatchObject({ engine: 'kokoro', voice: 'af_heart', variant: 'fp16' });
    });

    it('falls back to the defaults for an unmapped name, and says so once', async () => {
        // A station that says the wrong thing in the wrong voice is recoverable; one that goes
        // silent because a persona was renamed is not.
        const { plugin, calls, host } = await started({ config: { defaultVoice: 'af_heart' } });

        await plugin.speak(say({ voice: 'nobody' }));

        expect(sentBody(calls)).toMatchObject({ engine: 'kokoro', voice: 'af_heart' });
        expect(host.logger.warn).toHaveBeenCalledWith('no mapping for this voice; using the defaults', expect.objectContaining({ voice: 'nobody' }));
    });

    it('says nothing about a request that asked for no voice at all', async () => {
        const { plugin, host } = await started();

        await plugin.speak(say());

        expect(host.logger.warn).not.toHaveBeenCalled();
    });

    it('passes a delivery straight through, because the server drops one the build cannot do', async () => {
        const { plugin, calls } = await started();

        await plugin.speak(say({ delivery: 'hushed' }));

        expect(sentBody(calls)).toMatchObject({ delivery: 'hushed' });
    });

    it('leaves a cue where the writer put it, inside the text', async () => {
        const { plugin, calls } = await started();

        await plugin.speak(say({ text: 'Well [laugh] there you go.' }));

        expect(sentBody(calls).text).toBe('Well [laugh] there you go.');
    });

    it('prefers the format the caller asked for over the configured one', async () => {
        const { plugin, calls } = await started({ config: { format: 'wav' }, contentType: 'audio/flac' });

        await plugin.speak(say({ format: 'flac' }));

        expect(sentBody(calls).format).toBe('flac');
    });

    it('ignores a format this plugin has nowhere to file, and uses the configured one', async () => {
        // `pcm` is real on the server and answers audio/L16, which the segment store cannot hold.
        const { plugin, calls } = await started({ config: { format: 'wav' }, contentType: 'audio/wav' });

        await plugin.speak(say({ format: 'pcm' }));

        expect(sentBody(calls).format).toBe('wav');
    });

    it('hands the body back as it arrives rather than collecting it', async () => {
        const chunks = [audioChunk(1024), audioChunk(1024), audioChunk(2048)];
        const { plugin } = await started({ chunks });

        const handle = await plugin.speak(say());

        expect(await drain(handle.audio)).toBe(4096);
    });
});

describe('keepAliveSeconds', () => {
    it('sends nothing when the box is empty, leaving the server its own setting', async () => {
        const { plugin, calls } = await started();

        await plugin.speak(say());

        expect(sentBody(calls)).not.toHaveProperty('keepAliveSeconds');
    });

    it('sends a typed zero, which is not the same as an empty box', async () => {
        const { plugin, calls } = await started({ config: { keepAliveSeconds: 0 } });

        await plugin.speak(say());

        expect(sentBody(calls).keepAliveSeconds).toBe(0);
    });

    it('reads a hand-edited string as the number it holds', async () => {
        const { plugin, calls } = await started({ config: { keepAliveSeconds: '300' } });

        await plugin.speak(say());

        expect(sentBody(calls).keepAliveSeconds).toBe(300);
    });

    it('rounds a fraction and floors anything below never-expire', async () => {
        const rounded = await started({ config: { keepAliveSeconds: 2.7 } });
        await rounded.plugin.speak(say());
        expect(sentBody(rounded.calls).keepAliveSeconds).toBe(3);

        const floored = await started({ config: { keepAliveSeconds: -5 } });
        await floored.plugin.speak(say());
        expect(sentBody(floored.calls).keepAliveSeconds).toBe(-1);
    });

    it('ignores a value that is not a number at all', async () => {
        const { plugin, calls } = await started({ config: { keepAliveSeconds: 'forever' } });

        await plugin.speak(say());

        expect(sentBody(calls)).not.toHaveProperty('keepAliveSeconds');
    });
});

describe('what the bytes are', () => {
    it('reports what the server said it sent', async () => {
        const { plugin } = await started({ config: { format: 'mp3' }, contentType: 'audio/wav' });

        // Trusting the request over the response is how a wav gets announced as an mp3, which airs
        // as silence rather than as an error anybody sees.
        expect((await plugin.speak(say())).mime).toBe('audio/wav');
    });

    it('cuts the parameters off a type that carries them', () => {
        expect(mimeOf('audio/L16; rate=24000; channels=1', 'wav')).toBe('audio/L16'.toLowerCase());
    });

    it('files opus as ogg, which is what it is and what the store calls it', () => {
        expect(mimeOf('audio/opus', 'opus')).toBe('audio/ogg');
    });

    it('falls back to what was asked for when the server announced nothing', () => {
        expect(mimeOf(null, 'flac')).toBe('audio/flac');
        expect(mimeOf('', 'mp3')).toBe('audio/mpeg');
        expect(mimeOf('application/json', 'mp3')).toBe('audio/mpeg');
    });
});

describe('when it will not speak', () => {
    it('refuses before the network when no server is configured', async () => {
        const { plugin, calls } = await started({ config: { baseUrl: '' } });

        await expect(plugin.speak(say())).rejects.toMatchObject({ code: 'config' });
        expect(calls).toHaveLength(0);
    });

    it('refuses to ask for silence', async () => {
        const { plugin, calls } = await started();

        await expect(plugin.speak(say({ text: '   ' }))).rejects.toMatchObject({ code: 'config' });
        expect(calls).toHaveLength(0);
    });

    it('carries the reason out of a refusal, and lets the body go', async () => {
        const { plugin, cancelled } = await started({
            speakStatus: 404,
            speakBody: JSON.stringify({ error: { code: 'unknown_engine', message: 'no engine "kokoro"', retryable: false } }),
        });

        const error = (await plugin.speak(say()).catch((thrown: unknown) => thrown)) as PluginError;

        expect(isPluginError(error)).toBe(true);
        expect(error.code).toBe('config');
        expect(error.message).toContain('no engine "kokoro"');
        // Read to the end by the error path rather than cancelled, which lets the socket go just the
        // same: what matters is that nothing is left holding it open.
        expect(cancelled).toEqual([]);
    });

    it('fails at the end of a body too short to be audio', async () => {
        // A server can dribble a short JSON error out in pieces, so the question is only answerable
        // once it stops.
        const { plugin } = await started({ chunks: [new Uint8Array(12)] });

        const handle = await plugin.speak(say());

        await expect(drain(handle.audio)).rejects.toMatchObject({ code: 'upstream' });
    });

    it('accepts a body that is exactly at the floor', async () => {
        const { plugin } = await started({ chunks: [new Uint8Array(200), new Uint8Array(56)] });

        const handle = await plugin.speak(say());

        expect(await drain(handle.audio)).toBe(256);
    });
});

describe('speed', () => {
    const withSpeedDial = capabilities({ variants: { only: variant({ dials: { speed: { min: 0.5, max: 2, default: 1 } } }) } });

    it('sends a speed the build declares a dial for', async () => {
        const { plugin, calls } = await started({
            capabilities: { kokoro: withSpeedDial },
            config: { voices: voiceRows({ name: 'host', voice: 'af_heart', speed: '1.2' }) },
        });

        await plugin.speak(say({ voice: 'host' }));

        expect(sentBody(calls).params).toEqual({ speed: 1.2 });
    });

    it('clamps a speed the dial will not take, rather than losing the break to a 400', async () => {
        const { plugin, calls } = await started({
            capabilities: { kokoro: withSpeedDial },
            config: { voices: voiceRows({ name: 'host', voice: 'af_heart', speed: '9' }) },
        });

        await plugin.speak(say({ voice: 'host' }));

        expect(sentBody(calls).params).toEqual({ speed: 2 });
    });

    it('withholds a speed from a build that declares no such dial, and says why', async () => {
        // On this server an unknown dial key is a refusal naming it, not a field quietly ignored.
        const { plugin, calls, host } = await started({
            capabilities: { kokoro: capabilities() },
            config: { voices: voiceRows({ name: 'host', voice: 'af_heart', speed: '1.2' }) },
        });

        await plugin.speak(say({ voice: 'host' }));

        expect(sentBody(calls)).not.toHaveProperty('params');
        expect(host.logger.debug).toHaveBeenCalledWith(
            'rhapsode withheld the speed, because this build declares no speed dial',
            expect.objectContaining({ engine: 'kokoro' }),
        );
    });

    it('withholds a speed it could not confirm a dial for', async () => {
        const { plugin, calls } = await started({ config: { voices: voiceRows({ name: 'host', voice: 'af_heart', speed: '1.2' }) } });

        await plugin.speak(say({ voice: 'host' }));

        expect(sentBody(calls)).not.toHaveProperty('params');
    });

    it('reads what the engine can do once, however many lines it speaks', async () => {
        // The document decides the format as well as the dial, so it is read on the first line after
        // a restart — and then not again until it goes stale.
        const { plugin, calls } = await started({
            capabilities: { kokoro: withSpeedDial },
            config: { voices: voiceRows({ name: 'host', voice: 'af_heart', speed: '1.2' }) },
        });

        await plugin.speak(say({ voice: 'host' }));
        await plugin.speak(say({ voice: 'host' }));

        expect(calls.map(call => call.url)).toEqual([`${BASE_URL}/engines/kokoro/capabilities`, `${BASE_URL}/speak`, `${BASE_URL}/speak`]);
    });

    it('reads the dial off the variant the row names', async () => {
        const perVariant = capabilities({
            variants: {
                turbo: variant(),
                original: variant({ dials: { speed: { min: 0.5, max: 2, default: 1 } } }),
            },
        });

        const { plugin, calls } = await started({
            capabilities: { chatterbox: perVariant },
            config: { voices: voiceRows({ name: 'host', engine: 'chatterbox', voice: 'gravel', variant: 'original', speed: '1.5' }) },
        });

        await plugin.speak(say({ voice: 'host' }));

        expect(sentBody(calls).params).toEqual({ speed: 1.5 });
    });
});

describe('what this station can be asked for', () => {
    const kokoro = capabilities({
        variants: { only: variant({ cues: ['laugh', 'sigh'], deliveries: ['hushed'], maxCharacters: 4096 }) },
    });
    const chatterbox = capabilities({
        engine: { id: 'chatterbox', displayName: 'Chatterbox', adapterVersion: '0.3.1' },
        variants: { turbo: variant({ cues: ['gasp'], deliveries: ['frantic'], maxCharacters: 1000 }) },
    });

    const bothEngines = {
        capabilities: { kokoro, chatterbox },
        config: {
            voices: voiceRows({ name: 'host', voice: 'af_heart' }, { name: 'caller', engine: 'chatterbox', voice: 'gravel' }),
        },
    };

    it('claims every cue any build in use performs', async () => {
        // The union rather than the intersection: the server strips a cue the build it is about to
        // use does not claim, so over-claiming costs a flourish and never gets a word read out.
        const { plugin } = await started(bothEngines);

        expect(await plugin.listCues()).toEqual(['laugh', 'sigh', 'gasp']);
    });

    it('answers in the vocabulary the station owns order, not the order the table is in', async () => {
        const { plugin } = await started({
            capabilities: { kokoro: capabilities({ variants: { only: variant({ cues: ['groan', 'laugh'] }) } }) },
        });

        expect(await plugin.listCues()).toEqual(['laugh', 'groan']);
    });

    it('claims every delivery any build in use performs', async () => {
        const { plugin } = await started(bothEngines);

        expect(await plugin.listDeliveries()).toEqual(['hushed', 'frantic']);
    });

    it('takes the smallest ceiling, because the host chunks everything against one number', async () => {
        const { plugin } = await started(bothEngines);

        expect(await plugin.listLimits()).toEqual({ maxCharacters: 1000 });
    });

    it('leaves the host its own default when no build declares a ceiling', async () => {
        const { plugin } = await started({ capabilities: { kokoro: capabilities() } });

        expect(await plugin.listLimits()).toEqual({});
    });

    it('claims nothing at all when the server cannot be reached', async () => {
        const { plugin } = await started();

        expect(await plugin.listCues()).toEqual([]);
        expect(await plugin.listDeliveries()).toEqual([]);
        expect(await plugin.listLimits()).toEqual({});
    });

    it('asks each engine once however many voices point at it', async () => {
        const { plugin, calls } = await started({
            capabilities: { kokoro },
            config: {
                voices: voiceRows(
                    { name: 'host', voice: 'af_heart' },
                    { name: 'newsreader', voice: 'bf_emma' },
                    { name: 'caller', voice: 'am_adam' },
                ),
            },
        });

        await plugin.listCues();

        expect(calls.map(call => call.url)).toEqual([`${BASE_URL}/engines/kokoro/capabilities`]);
    });

    it('reads every build the table can reach, not just the loaded one', async () => {
        const perVariant = capabilities({
            engine: { id: 'chatterbox', displayName: 'Chatterbox', adapterVersion: '0.3.1' },
            variants: { turbo: variant({ cues: ['laugh'] }), multilingual: variant({ cues: ['sigh'] }) },
        });

        const { plugin } = await started({
            capabilities: { chatterbox: perVariant },
            config: {
                defaultEngine: 'chatterbox',
                voices: voiceRows({ name: 'host', voice: 'gravel', variant: 'turbo' }, { name: 'caller', voice: 'reedy', variant: 'multilingual' }),
            },
        });

        expect(await plugin.listCues()).toEqual(['laugh', 'sigh']);
    });
});

describe('testConnection', () => {
    const health = (over: Partial<CoreHealth> = {}): CoreHealth => ({
        contract: 1,
        status: 'ok',
        engines: [{ id: 'kokoro', displayName: 'Kokoro', license: MIT, process: 'up', model: 'loaded', restarts: 0 }],
        residency: { resident: 1, max: 1, waiting: 0 },
        ...over,
    });

    it('says what the server has, and what the default engine is doing on it', async () => {
        const { plugin } = await started({ health: health() });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(true);
        expect(result.message).toContain('1 engine installed');
        expect(result.message).toContain('"kokoro" is up, model loaded');
        expect(result.message).toContain('1 of 1 model slots in use');
    });

    it('says when the default engine is a name this server does not have', async () => {
        // The one thing an operator cannot see from the form, and the difference between a station
        // that speaks and one that fails every break with `unknown_engine`.
        const { plugin } = await started({ config: { defaultEngine: 'orpheus' }, health: health() });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(true);
        expect(result.message).toContain('no engine called "orpheus"');
    });

    it('answers rather than throwing when nothing is listening', async () => {
        // Three presses against a stopped server would otherwise quarantine the plugin and take the
        // station's voice off air.
        const { plugin } = await started({ healthThrows: true });

        await expect(plugin.testConnection()).resolves.toMatchObject({ ok: false });
    });

    it('answers rather than throwing when something else is listening', async () => {
        const { plugin } = await started({ healthStatus: 404 });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(false);
        expect(result.message).toContain('answered as a Rhapsode server');
    });

    it('refuses before the network with no address at all', async () => {
        const { plugin, calls } = await started({ config: { baseUrl: '' } });

        await expect(plugin.testConnection()).resolves.toEqual({ ok: false, message: 'No server URL set.' });
        expect(calls).toHaveLength(0);
    });
});

describe('listVoices', () => {
    it('reports the station names, with the address as the description', async () => {
        const { plugin } = await started({
            config: { voices: voiceRows({ name: 'host', engine: 'chatterbox', voice: 'gravel', variant: 'turbo', speed: '1.2' }) },
        });

        const [, host] = await plugin.listVoices();

        expect(host).toMatchObject({ id: 'host', label: 'host', description: 'gravel on chatterbox (turbo) at 1.2x' });
    });

    it('always offers the fallback, so a station with no mappings has something to preview', async () => {
        const { plugin } = await started({ config: { defaultEngine: 'orpheus' } });

        const voices = await plugin.listVoices();

        expect(voices).toHaveLength(1);
        expect(voices[0]).toMatchObject({ id: '', label: 'Default', description: "orpheus's own default voice" });
    });

    it('keys the preview on every part of the address', async () => {
        const { plugin } = await started({
            config: {
                voices: voiceRows(
                    { name: 'plain', voice: 'af_heart' },
                    { name: 'quick', voice: 'af_heart', speed: '1.1' },
                    { name: 'pinned', voice: 'af_heart', variant: 'fp16' },
                ),
            },
        });

        const specs = (await plugin.listVoices()).map(voice => voice.spec);

        expect(new Set(specs).size).toBe(specs.length);
    });
});

describe('suggestConfigOptions', () => {
    const engines = [
        { id: 'kokoro', displayName: 'Kokoro', license: MIT, process: 'up' as const, model: 'loaded' as const, restarts: 0 },
        { id: 'chatterbox', displayName: 'Chatterbox', license: MIT, process: 'down' as const, model: 'unloaded' as const, restarts: 0 },
    ];

    const both = {
        engines,
        capabilities: {
            kokoro: capabilities({ variants: { fp16: variant(), fp32: variant() } }),
            chatterbox: capabilities({ variants: { turbo: variant() } }),
        },
        voices: {
            kokoro: [{ id: 'af_heart', label: 'Heart', spec: 'x' }],
            chatterbox: [{ id: 'gravel', label: 'Gravel', spec: 'y' }],
        },
    };

    it('offers the engines this server has installed, for both places one is named', async () => {
        const { plugin } = await started(both);

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested.defaultEngine).toEqual([
            { value: 'kokoro', label: 'Kokoro' },
            { value: 'chatterbox', label: 'Chatterbox' },
        ]);
        expect(suggested['voices.engine']).toEqual(suggested.defaultEngine);
    });

    it('labels each voice with the engine that holds it, since the ids are only unique within one', async () => {
        const { plugin } = await started(both);

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested['voices.voice']).toEqual([
            { value: 'af_heart', label: 'Heart (kokoro)' },
            { value: 'gravel', label: 'Gravel (chatterbox)' },
        ]);
    });

    it('offers every build each engine could load', async () => {
        const { plugin } = await started(both);

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested['voices.variant']).toEqual([
            { value: 'fp16', label: 'fp16 (kokoro)' },
            { value: 'fp32', label: 'fp32 (kokoro)' },
            { value: 'turbo', label: 'turbo (chatterbox)' },
        ]);
    });

    it('gives up before the fan-out when the server did not list its engines', async () => {
        // Nothing to ask the rest of, and an operator fixing a bad address needs the form rather
        // than an error where the choices should be.
        const { plugin, calls } = await started({ enginesStatus: 503 });

        expect(await plugin.suggestConfigOptions()).toEqual({});
        expect(calls.map(call => call.url)).toEqual([`${BASE_URL}/engines`]);
    });

    it('still offers the engines when none of them would list a voice', async () => {
        const { plugin } = await started({ engines });

        const suggested = await plugin.suggestConfigOptions();

        expect(suggested.defaultEngine).toHaveLength(2);
        expect(suggested).not.toHaveProperty('voices.voice');
        expect(suggested).not.toHaveProperty('defaultVoice');
    });
});

describe('the format it asks for', () => {
    it('asks for the configured one when this server can encode it', async () => {
        const { plugin, calls } = await started({ capabilities: { kokoro: capabilities({ formats: ['wav', 'mp3'] }) } });

        await plugin.speak(say());

        expect(sentBody(calls).format).toBe('mp3');
    });

    it('asks for wav rather than losing the break, when the server was built without ffmpeg', async () => {
        // Measured against a real server: mp3, opus and flac each need an encoder compiled in, and
        // asking for one it has not got is a 422 naming the format.
        const { plugin, calls, host } = await started({
            capabilities: { kokoro: capabilities({ formats: ['pcm', 'wav'] }) },
            contentType: 'audio/wav',
        });

        const handle = await plugin.speak(say());

        expect(sentBody(calls).format).toBe('wav');
        expect(handle.mime).toBe('audio/wav');
        expect(host.logger.debug).toHaveBeenCalledWith(
            'rhapsode asked for a different format, because this server cannot encode the one configured',
            expect.objectContaining({ wanted: 'mp3', instead: 'wav' }),
        );
    });

    it('asks as configured when the server would not describe itself', async () => {
        // Guessing from no evidence would trade a refusal that names the problem for a format
        // nobody chose.
        const { plugin, calls } = await started();

        await plugin.speak(say());

        expect(sentBody(calls).format).toBe('mp3');
    });

    it('asks as configured when nothing it could store is on offer', async () => {
        // pcm alone: the station has nowhere to put audio/L16, so let the server say so.
        const { plugin, calls } = await started({ capabilities: { kokoro: capabilities({ formats: ['pcm'] }) } });

        await plugin.speak(say());

        expect(sentBody(calls).format).toBe('mp3');
    });
});
