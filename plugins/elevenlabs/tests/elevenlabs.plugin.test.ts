import { describe, expect, it } from 'vitest';
import { isPluginError, PluginError } from '@deadair/plugin-sdk';
import { createFakePluginHost, type FakePluginHost, type RecordedFetchCall } from '@deadair/plugin-sdk/testing';

import { DEFAULT_VOICE } from '../src/elevenlabs.manifest.js';
import { ElevenLabsPlugin } from '../src/elevenlabs.plugin.js';

const KEY = 'xi-test-key';

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
    /** `undefined` to seed no key at all. */
    apiKey?: string | undefined;
    chunks?: Uint8Array[];
    speakStatus?: number;
    /** The refusal body a non-2xx speech call answers with. */
    speakError?: unknown;
    voicesStatus?: number;
    voicesBody?: unknown;
    /** Throw from `host.fetch` for the voices list, as an unreachable host does. */
    voicesThrow?: boolean;
    subscriptionStatus?: number;
    subscriptionBody?: unknown;
    modelsStatus?: number;
    modelsBody?: unknown;
}

function fakeHost(options: FakeHostOptions = {}) {
    const read: string[] = [];
    const host: FakePluginHost = createFakePluginHost();

    host.setFetchImpl(async (url: string): Promise<Response> => {
        if (url.includes('/v1/text-to-speech/')) {
            const status = options.speakStatus ?? 200;
            const ok = status >= 200 && status < 300;
            const body = ok
                ? streamOf(options.chunks ?? [audioChunk()])
                : streamOf([Buffer.from(JSON.stringify(options.speakError ?? { detail: { status: 'nope', message: 'nope' } }))]);
            const response = new Response(body, { status, headers: { 'content-type': ok ? 'audio/mpeg' : 'application/json' } });

            // Wrapped so a test can assert the plugin released a refusal's body.
            const text = response.text.bind(response);
            response.text = async () => {
                read.push('speech');
                return text();
            };
            return response;
        }

        if (url.endsWith('/v1/voices')) {
            if (options.voicesThrow) throw new PluginError('plugin "deadair.elevenlabs" fetch failed: ENOTFOUND').withCode('upstream');
            return new Response(JSON.stringify(options.voicesBody ?? { voices: [{ voice_id: 'a' }, { voice_id: 'b' }] }), {
                status: options.voicesStatus ?? 200,
            });
        }

        if (url.endsWith('/v1/models')) {
            const body = options.modelsBody ?? [
                { model_id: 'eleven_v4', languages: [{ language_id: 'en' }, { language_id: 'de' }] },
                { model_id: 'eleven_v3', languages: [{ language_id: 'en' }] },
            ];
            return new Response(JSON.stringify(body), { status: options.modelsStatus ?? 200 });
        }

        if (url.endsWith('/v1/user/subscription')) {
            return new Response(
                JSON.stringify(
                    options.subscriptionBody ?? { character_count: 1234, character_limit: 10000, next_character_count_reset_unix: 1_791_331_200 },
                ),
                { status: options.subscriptionStatus ?? 200 },
            );
        }

        return new Response('not here', { status: 404 });
    });

    const apiKey = 'apiKey' in options ? options.apiKey : KEY;
    if (apiKey !== undefined) host.seedSecret('apiKey', apiKey);
    host.seedConfig({ ...options.config });

    return { host, calls: host.calls, read };
}

async function started(options: FakeHostOptions = {}) {
    const fake = fakeHost(options);
    const plugin = new ElevenLabsPlugin();
    await plugin.init(fake.host);
    return { plugin, ...fake };
}

const speechCall = (calls: RecordedFetchCall[]): RecordedFetchCall => {
    const call = calls.find(c => c.url.includes('/v1/text-to-speech/'));
    if (call === undefined) throw new Error('no speech call was made');
    return call;
};

const bodyOf = (call: RecordedFetchCall): Record<string, unknown> => JSON.parse(call.body ?? '{}') as Record<string, unknown>;

const drain = async (stream: ReadableStream<Uint8Array>): Promise<number> => {
    let total = 0;
    for await (const chunk of stream) total += chunk.byteLength;
    return total;
};

const refusal = async (promise: Promise<unknown>): Promise<PluginError> => {
    const error = await promise.then(
        () => undefined,
        (reason: unknown) => reason,
    );
    if (!isPluginError(error)) throw new Error(`expected a PluginError, got ${String(error)}`);
    return error;
};

describe('ElevenLabsPlugin.speak', () => {
    it('posts the script to the voice with the key, model and format, and returns the body as mp3', async () => {
        const { plugin, calls } = await started({ config: { voices: voiceRows({ name: 'host', voice: 'voice-host' }) } });

        const handle = await plugin.speak({ text: '  Good evening.  ', voice: 'host' });

        const call = speechCall(calls);
        expect(call.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-host?output_format=mp3_44100_128');
        expect(call.method).toBe('POST');
        expect(call.headers?.['xi-api-key']).toBe(KEY);
        expect(bodyOf(call)).toEqual({ text: 'Good evening.', model_id: 'eleven_v4' });
        expect(handle.mime).toBe('audio/mpeg');
        expect(await drain(handle.audio)).toBe(4096);
    });

    it('streams the body rather than buffering it', async () => {
        const { plugin } = await started({ chunks: [audioChunk(1024), audioChunk(1024), audioChunk(1024)] });

        const handle = await plugin.speak({ text: 'Hello.' });
        const reader = handle.audio.getReader();
        const first = await reader.read();

        expect(first.value?.byteLength).toBe(1024);
        await reader.cancel();
    });

    it('uses the configured model and format', async () => {
        const { plugin, calls } = await started({ config: { model: 'eleven_flash_v2_5', format: 'mp3_22050_32' } });

        await plugin.speak({ text: 'Hello.' });

        const call = speechCall(calls);
        expect(call.url).toContain('output_format=mp3_22050_32');
        expect(bodyOf(call).model_id).toBe('eleven_flash_v2_5');
    });

    it('falls back to the default voice for an unmapped name, and warns', async () => {
        const { plugin, calls, host } = await started();

        await plugin.speak({ text: 'Hello.', voice: 'nobody' });

        expect(speechCall(calls).url).toContain(`/v1/text-to-speech/${DEFAULT_VOICE}?`);
        expect(host.logger.warn).toHaveBeenCalled();
    });

    it('uses the default voice without a warning when no voice is asked for', async () => {
        const { plugin, calls, host } = await started({ config: { defaultVoice: 'my-default' } });

        await plugin.speak({ text: 'Hello.' });

        expect(speechCall(calls).url).toContain('/v1/text-to-speech/my-default?');
        expect(host.logger.warn).not.toHaveBeenCalled();
    });

    it('sends every setting a model reads, clamped, and omits blank ones', async () => {
        const { plugin, calls } = await started({
            config: {
                model: 'eleven_v3',
                voices: voiceRows({ name: 'host', voice: 'v', stability: '0.3', similarity: '', style: '2', speed: '0.5' }),
            },
        });

        await plugin.speak({ text: 'Hello.', voice: 'host' });

        expect(bodyOf(speechCall(calls)).voice_settings).toEqual({ stability: 0.3, style: 1, speed: 0.7 });
    });

    it('sends only stability and similarity to v4, which reads nothing else', async () => {
        const { plugin, calls } = await started({
            config: { voices: voiceRows({ name: 'host', voice: 'v', stability: '0.4', similarity: '0.9', style: '0.5', speed: '1.1' }) },
        });

        await plugin.speak({ text: 'Hello.', voice: 'host' });

        expect(bodyOf(speechCall(calls)).voice_settings).toEqual({ stability: 0.4, similarity_boost: 0.9 });
    });

    it('sends no voice_settings at all when v4 is handed only settings it does not read', async () => {
        const { plugin, calls } = await started({ config: { voices: voiceRows({ name: 'host', voice: 'v', speed: '1.1' }) } });

        await plugin.speak({ text: 'Hello.', voice: 'host' });

        expect(bodyOf(speechCall(calls))).not.toHaveProperty('voice_settings');
    });

    it('refuses as config without a key, and makes no call', async () => {
        const { plugin, calls } = await started({ apiKey: undefined });

        const error = await refusal(plugin.speak({ text: 'Hello.' }));

        expect(error.code).toBe('config');
        expect(calls).toHaveLength(0);
    });

    it('refuses to say nothing', async () => {
        const { plugin } = await started();

        expect((await refusal(plugin.speak({ text: '   ' }))).code).toBe('config');
    });

    it('turns a refusal into the error its reason calls for, and reads the body to release it', async () => {
        const { plugin, read } = await started({
            speakStatus: 401,
            speakError: { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota of 10000.' } },
        });

        const error = await refusal(plugin.speak({ text: 'Hello.' }));

        expect(error.code).toBe('forbidden');
        expect(error.message).toContain('exceeds your quota');
        expect(read).toEqual(['speech']);
    });

    it('refuses a body too small to be audio', async () => {
        const { plugin } = await started({ chunks: [new Uint8Array(10)] });

        const handle = await plugin.speak({ text: 'Hello.' });

        await expect(drain(handle.audio)).rejects.toThrow(/elevenlabs/);
    });
});

describe('ElevenLabsPlugin.listVoices', () => {
    it('lists the default and every mapping, with a spec that names the model and the settings sent', async () => {
        const { plugin } = await started({
            config: { voices: voiceRows({ name: 'host', voice: 'v1', stability: '0.4', speed: '1.1' }, { name: 'news', voice: 'v2' }) },
        });

        const voices = await plugin.listVoices();

        expect(voices.map(v => v.id)).toEqual(['', 'host', 'news']);
        expect(voices[0]?.spec).toBe(`${DEFAULT_VOICE}@eleven_v4`);
        // Speed is not sent to v4, so it does not re-key the preview.
        expect(voices[1]?.spec).toBe('v1@eleven_v4@stability=0.4');
        expect(voices[2]?.spec).toBe('v2@eleven_v4');
    });

    it('re-keys every preview when the model changes', async () => {
        const v4 = await started({ config: { voices: voiceRows({ name: 'host', voice: 'v1' }) } });
        const v3 = await started({ config: { model: 'eleven_v3', voices: voiceRows({ name: 'host', voice: 'v1' }) } });

        const [a, b] = await Promise.all([v4.plugin.listVoices(), v3.plugin.listVoices()]);

        expect(a[1]?.spec).not.toBe(b[1]?.spec);
    });
});

describe('ElevenLabsPlugin.testConnection', () => {
    it('reports the number of voices on the account and the quota', async () => {
        const { plugin, calls } = await started();

        expect(await plugin.testConnection()).toEqual({
            ok: true,
            message: 'Connected. 2 voices on this account. 1,234 of 10,000 characters used this period, resetting 2026-10-07.',
        });
        expect(calls.map(c => c.headers?.['xi-api-key'])).toEqual([KEY, KEY]);
    });

    it('still passes, and says so, when the key may not read its quota', async () => {
        const { plugin } = await started({ subscriptionStatus: 401 });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(true);
        expect(result.message).toContain('quota could not be read');
    });

    it('answers rather than throwing when there is no key', async () => {
        const { plugin } = await started({ apiKey: undefined });

        expect(await plugin.testConnection()).toEqual({ ok: false, message: 'No API key set.' });
    });

    it('answers rather than throwing when the service cannot be reached', async () => {
        const { plugin } = await started({ voicesThrow: true });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/Could not reach ElevenLabs/);
    });

    it("answers with the service's own reason for a refused key", async () => {
        const { plugin } = await started({ voicesStatus: 401, voicesBody: { detail: { status: 'invalid_api_key', message: 'Invalid API key' } } });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(false);
        expect(result.message).toContain('Invalid API key');
    });
});

describe('ElevenLabsPlugin.suggestConfigOptions', () => {
    it("offers the account's voices for the voice column and the default, and the known models", async () => {
        const { plugin } = await started({
            voicesBody: { voices: [{ voice_id: 'v1', name: 'George', category: 'premade' }, { voice_id: 'v2', name: 'Mine' }, { name: 'no id' }] },
        });

        const options = await plugin.suggestConfigOptions();

        const voices = [
            { value: 'v1', label: 'George (premade)' },
            { value: 'v2', label: 'Mine' },
        ];
        expect(options['voices.voice']).toEqual(voices);
        expect(options.defaultVoice).toEqual(voices);
        expect(options.model?.map(o => o.value)).toEqual([
            'eleven_v4',
            'eleven_v4_turbo',
            'eleven_v3',
            'eleven_multilingual_v2',
            'eleven_flash_v2_5',
        ]);
    });

    it('offers the models alone, rather than throwing, when the account cannot be read', async () => {
        const { plugin } = await started({ voicesThrow: true });

        expect(Object.keys(await plugin.suggestConfigOptions())).toEqual(['model']);
    });

    it('offers the models alone without a key, and asks nothing', async () => {
        const { plugin, calls } = await started({ apiKey: undefined });

        expect(Object.keys(await plugin.suggestConfigOptions())).toEqual(['model']);
        expect(calls).toHaveLength(0);
    });
});

describe('ElevenLabsPlugin, what the model can do', () => {
    it('claims the cues and deliveries v4 has tags for, and performs them', async () => {
        const { plugin, calls } = await started();

        expect(await plugin.listCues()).toEqual(['laugh', 'sigh', 'gasp', 'clear throat']);
        expect(await plugin.listDeliveries()).toEqual(['hushed', 'frantic']);

        await plugin.speak({ text: 'Well [laugh] there it is.', delivery: 'hushed' });

        expect(bodyOf(speechCall(calls)).text).toBe('[hushed] Well [laughs] there it is.');
    });

    it('claims nothing on a model that performs no tags, and strips what arrives anyway', async () => {
        const { plugin, calls } = await started({ config: { model: 'eleven_flash_v2_5' } });

        expect(await plugin.listCues()).toEqual([]);
        expect(await plugin.listDeliveries()).toEqual([]);

        await plugin.speak({ text: 'Well [laugh] there it is.', delivery: 'hushed' });

        expect(bodyOf(speechCall(calls)).text).toBe('Well there it is.');
    });

    it('claims nothing on a model it does not know', async () => {
        const { plugin } = await started({ config: { model: 'eleven_v9' } });

        expect(await plugin.listCues()).toEqual([]);
        expect(await plugin.listLimits()).toEqual({});
    });

    it("declares the model's character ceiling", async () => {
        expect(await (await started()).plugin.listLimits()).toEqual({ maxCharacters: 10_000 });
        expect(await (await started({ config: { model: 'eleven_v3' } })).plugin.listLimits()).toEqual({ maxCharacters: 5_000 });
    });

    it("lists the configured model's languages once, from the service", async () => {
        const { plugin, calls } = await started();

        expect(await plugin.listLanguages()).toEqual(['en', 'de']);
        expect(await plugin.listLanguages()).toEqual(['en', 'de']);
        expect(calls.filter(c => c.url.endsWith('/v1/models'))).toHaveLength(1);
    });

    it('answers no languages, rather than throwing, when the service will not say', async () => {
        const { plugin } = await started({ modelsStatus: 500 });

        expect(await plugin.listLanguages()).toEqual([]);
    });

    it('sends language_code only to a model that takes it, as the primary subtag', async () => {
        const v4 = await started();
        await v4.plugin.speak({ text: 'Guten Abend.', language: 'de-DE' });
        expect(bodyOf(speechCall(v4.calls))).not.toHaveProperty('language_code');

        const flash = await started({ config: { model: 'eleven_flash_v2_5' } });
        await flash.plugin.speak({ text: 'Guten Abend.', language: 'de-DE' });
        expect(bodyOf(speechCall(flash.calls)).language_code).toBe('de');
    });
});
