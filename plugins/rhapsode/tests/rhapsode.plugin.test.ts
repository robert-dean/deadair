import { describe, expect, it } from 'vitest';
import { isPluginError, type PluginError, type SpeechRequest } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

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
}

function fakeHost(options: FakeHostOptions = {}) {
    // Every body this fake hands out that was let go rather than read, so a test can assert the
    // plugin did not leave a socket open.
    const cancelled: string[] = [];

    const host: FakePluginHost = createFakePluginHost();

    host.setFetchImpl(async (url: string): Promise<Response> => {
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

        expect(calls[0]?.url).toBe(`${BASE_URL}/speak`);
        expect(calls[0]?.method).toBe('POST');
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
