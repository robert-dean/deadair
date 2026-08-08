import { describe, expect, it, vi } from 'vitest';
import { isPluginError, type HostFetchInit, type HostStreamChunk, type HostStreamOpen, type PluginError, type PluginHost } from '@deadair/plugin-sdk';

import { KokoroPlugin } from '../src/kokoro.plugin.js';

const BASE_URL = 'http://kokoro.test:8880/v1';

/** Enough bytes to clear the "this is not audio" floor. */
const audioChunk = (size = 4096): string => Buffer.alloc(size, 7).toString('base64');

interface FakeHostOptions {
    config?: Record<string, unknown>;
    apiKey?: string;
    /** Chunks the opened stream will hand back, in order, before it says done. */
    chunks?: string[];
    openStatus?: number;
    fetchResponse?: Partial<{ ok: boolean; status: number; body: string }>;
}

function fakeHost(options: FakeHostOptions = {}) {
    const opened: { url: string; init?: HostFetchInit }[] = [];
    const closed: string[] = [];
    const chunks = options.chunks ?? [audioChunk()];
    let cursor = 0;
    let seq = 0;

    const streams = {
        open: vi.fn(async (url: string, init?: HostFetchInit): Promise<HostStreamOpen> => {
            opened.push({ url, init });
            const status = options.openStatus ?? 200;
            return { streamId: 'host-1', status, headers: {}, ok: status >= 200 && status < 300, url };
        }),
        read: vi.fn(async (streamId: string): Promise<HostStreamChunk> => {
            if (cursor >= chunks.length) return { streamId, seq: seq++, done: true };
            return { streamId, seq: seq++, data: chunks[cursor++], done: false };
        }),
        close: vi.fn(async (streamId: string) => {
            closed.push(streamId);
        }),
    };

    const host = {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        fetch: vi.fn(async () => ({
            status: options.fetchResponse?.status ?? 200,
            statusText: '',
            headers: {},
            setCookie: [],
            body: options.fetchResponse?.body ?? JSON.stringify({ voices: [{ id: 'af_heart' }] }),
            ok: options.fetchResponse?.ok ?? true,
            url: BASE_URL,
            redirected: false,
        })),
        remainingMs: async () => 30_000,
        streams,
        storage: {} as PluginHost['storage'],
        secrets: { get: vi.fn(async () => options.apiKey) },
        config: { get: vi.fn(async () => ({ baseUrl: BASE_URL, ...options.config })) },
        oauth: {} as PluginHost['oauth'],
        events: {} as PluginHost['events'],
        trackFetcher: {} as PluginHost['trackFetcher'],
    } as unknown as PluginHost;

    return { host, streams, opened, closed };
}

async function started(options: FakeHostOptions = {}) {
    const fake = fakeHost(options);
    const plugin = new KokoroPlugin();
    await plugin.init(fake.host);
    return { ...fake, plugin };
}

/** Drains a handle the way the host does, and answers with the bytes. */
async function drain(plugin: KokoroPlugin, streamId: string): Promise<Buffer> {
    const parts: Buffer[] = [];
    try {
        for (;;) {
            const chunk = await plugin.readStream(streamId);
            if (chunk.done) break;
            parts.push(Buffer.from(chunk.data ?? '', 'base64'));
        }
    } finally {
        await plugin.closeStream(streamId);
    }
    return Buffer.concat(parts);
}

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
    it('posts the script and hands back a handle rather than the audio', async () => {
        const { plugin, opened } = await started();

        const handle = await plugin.speak({ text: 'You are listening to Deadair.' });

        expect(opened).toHaveLength(1);
        expect(opened[0]!.url).toBe(`${BASE_URL}/audio/speech`);
        expect(opened[0]!.init?.method).toBe('POST');
        expect(JSON.parse(opened[0]!.init?.body ?? '{}')).toMatchObject({
            model: 'kokoro',
            input: 'You are listening to Deadair.',
            voice: 'af_heart',
            response_format: 'mp3',
        });
        expect(handle.mime).toBe('audio/mpeg');
        expect(typeof handle.streamId).toBe('string');
    });

    it('answers with the media type it actually produced, not the one asked for', async () => {
        const { plugin } = await started({ config: { format: 'wav' } });

        // `SpeechRequest.format` is a hint; the configured format wins and the
        // mime reports the truth, because that header is what the station stores
        // the audio under and what every consumer decides from.
        const handle = await plugin.speak({ text: 'hello', format: 'nonsense' });

        expect(handle.mime).toBe('audio/wav');
    });

    it('maps a station voice name to the engine voice the operator set', async () => {
        const { plugin, opened } = await started({ config: { voices: 'host = af_bella\nnewsreader: am_michael' } });

        await plugin.speak({ text: 'hello', voice: 'newsreader' });

        expect(JSON.parse(opened[0]!.init?.body ?? '{}').voice).toBe('am_michael');
    });

    it('falls back to the default voice for a name it has no mapping for, and says so', async () => {
        const { plugin, opened, host } = await started({ config: { voices: 'host = af_bella', defaultVoice: 'af_heart' } });

        await plugin.speak({ text: 'hello', voice: 'renamed-persona' });

        // A station that says the wrong thing in the wrong voice is recoverable;
        // one that goes silent because a persona was renamed is not.
        expect(JSON.parse(opened[0]!.init?.body ?? '{}').voice).toBe('af_heart');
        expect(host.logger.warn).toHaveBeenCalled();
    });

    it('refuses to try at all when no server has been configured', async () => {
        const { plugin } = await started({ config: { baseUrl: '   ' } });

        expect(await rejectionCode(plugin.speak({ text: 'hello' }))).toBe('config');
    });

    it('reports an authentication failure apart from any other refusal', async () => {
        const denied = await started({ openStatus: 401 });
        const broken = await started({ openStatus: 500 });

        expect(await rejectionCode(denied.plugin.speak({ text: 'hello' }))).toBe('auth');
        expect(await rejectionCode(broken.plugin.speak({ text: 'hello' }))).toBe('upstream');
    });

    it('lets go of the socket when the server refuses, since nothing will be draining it', async () => {
        const { plugin, closed } = await started({ openStatus: 500 });

        await plugin.speak({ text: 'hello' }).catch(() => {});

        expect(closed).toEqual(['host-1']);
    });
});

describe('KokoroPlugin.readStream', () => {
    it('forwards the audio chunk by chunk and ends with a terminal chunk', async () => {
        const { plugin } = await started({ chunks: [audioChunk(2048), audioChunk(2048)] });

        const handle = await plugin.speak({ text: 'hello' });
        const audio = await drain(plugin, handle.streamId);

        expect(audio.byteLength).toBe(4096);
    });

    it('refuses a reply too small to be audio, which is how a JSON error page reaches the air', async () => {
        // v1 paid for this one: a 200 carrying a complaint about the voice becomes
        // a segment that airs as a click, and here is the only place to notice.
        const { plugin } = await started({ chunks: [Buffer.from('{"detail":"no such voice"}').toString('base64')] });

        const handle = await plugin.speak({ text: 'hello' });

        expect(await rejectionCode(drain(plugin, handle.streamId))).toBe('upstream');
    });

    it('answers a handle it does not have as not_found rather than as a fault', async () => {
        const { plugin } = await started();

        expect(await rejectionCode(plugin.readStream('speak-nonsense'))).toBe('not_found');
    });

    it('keeps its own stream ids, so nothing hands the host back its own', async () => {
        const { plugin, streams } = await started();

        const handle = await plugin.speak({ text: 'hello' });
        await plugin.readStream(handle.streamId);

        expect(handle.streamId).not.toBe('host-1');
        expect(streams.read).toHaveBeenCalledWith('host-1', undefined);
    });
});

describe('KokoroPlugin.closeStream', () => {
    it('is idempotent, because the host calls it from a finally', async () => {
        const { plugin, closed } = await started();
        const handle = await plugin.speak({ text: 'hello' });

        await plugin.closeStream(handle.streamId);
        await plugin.closeStream(handle.streamId);
        await plugin.closeStream('never-existed');

        expect(closed).toEqual(['host-1']);
    });

    it('closes what is still open when the plugin is disposed', async () => {
        const { plugin, closed } = await started();
        await plugin.speak({ text: 'hello' });

        await plugin.dispose();

        expect(closed).toEqual(['host-1']);
    });
});

describe('KokoroPlugin.testConnection', () => {
    it('reports how many voices the server has', async () => {
        const { plugin } = await started();

        await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected. 1 voices available.' });
    });

    it('reports a server that answered with a failure', async () => {
        const { plugin } = await started({ fetchResponse: { ok: false, status: 503 } });

        await expect(plugin.testConnection()).resolves.toEqual({ ok: false, message: 'Server answered HTTP 503.' });
    });

    it('accepts a server whose voice list is shaped differently, because it still speaks', async () => {
        const { plugin } = await started({ fetchResponse: { body: 'not json at all' } });

        await expect(plugin.testConnection()).resolves.toEqual({ ok: true, message: 'Connected.' });
    });
});

describe('KokoroPlugin.listVoices', () => {
    it('lists the station names, not everything the engine can do', async () => {
        const { plugin } = await started({ config: { voices: 'host = af_bella', defaultVoice: 'af_heart' } });

        const voices = await plugin.listVoices();

        // A voice Kokoro has and the operator never named is not something the
        // station can ask for, so it is not offered.
        expect(voices.map(voice => voice.id)).toEqual(['', 'host']);
        expect(voices[0]!.description).toContain('af_heart');
        expect(voices[1]!.description).toContain('af_bella');
    });
});
