import { describe, expect, it, vi } from 'vitest';
import type { PluginLogger } from '@deadair/plugin-sdk';
import type { Capabilities, Variant } from '@maroonedsoftware/rhapsode-sdk';

import {
    cuesOf,
    deliveriesOf,
    effectiveVariant,
    EngineCapabilities,
    maxCharactersOf,
    speedDialOf,
    speedWithin,
} from '../src/rhapsode.capabilities.js';

const BASE_URL = 'http://rhapsode.test:8080';

const silent = (): PluginLogger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const variant = (over: Partial<Variant> = {}): Variant => ({ cues: [], deliveries: [], dials: {}, ...over });

const document = (over: Partial<Capabilities> = {}): Capabilities => ({
    contract: 1,
    engine: { id: 'kokoro', displayName: 'Kokoro', adapterVersion: '0.1.0' },
    license: { code: 'GPL-3.0-or-later', weights: 'Apache-2.0', weightsCommercialUse: true },
    device: { type: 'cpu', name: 'a laptop' },
    variants: { fp16: variant() },
    formats: ['wav', 'pcm'],
    ...over,
});

/** A source whose answers a test scripts, counting how often it was actually asked. */
function fakeSource(answers: (Response | Error)[]) {
    const urls: string[] = [];
    const logger = silent();

    const capabilities = new EngineCapabilities({
        baseUrl: BASE_URL,
        logger,
        ttlMs: 50,
        fetch: async (url: string) => {
            urls.push(url);
            const next = answers.shift();
            if (next === undefined) throw new Error(`nothing scripted for ${url}`);
            if (next instanceof Error) throw next;

            return next;
        },
    });

    return { capabilities, urls, logger };
}

const answering = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('EngineCapabilities', () => {
    it('asks the engine what it can do, once', async () => {
        const { capabilities, urls } = fakeSource([answering(document())]);

        expect((await capabilities.of('kokoro'))?.engine.id).toBe('kokoro');
        expect((await capabilities.of('kokoro'))?.engine.id).toBe('kokoro');
        expect(urls).toEqual([`${BASE_URL}/engines/kokoro/capabilities`]);
    });

    it('asks again once the answer has gone stale', async () => {
        const { capabilities, urls } = fakeSource([answering(document()), answering(document({ formats: ['wav'] }))]);

        await capabilities.of('kokoro');
        await new Promise(resolve => setTimeout(resolve, 60));

        expect((await capabilities.of('kokoro'))?.formats).toEqual(['wav']);
        expect(urls).toHaveLength(2);
    });

    it('keeps the last answer when the server has gone quiet', async () => {
        // A server that is briefly unreachable has not changed what its engines can do, and the
        // alternative is a break written with no cues in it for the sake of one timed-out call.
        const { capabilities } = fakeSource([answering(document({ formats: ['wav', 'mp3'] })), new Error('ECONNREFUSED')]);

        await capabilities.of('kokoro');
        await new Promise(resolve => setTimeout(resolve, 60));

        expect((await capabilities.of('kokoro'))?.formats).toEqual(['wav', 'mp3']);
    });

    it('answers nothing for an engine it has never managed to read', async () => {
        const { capabilities, logger } = fakeSource([new Error('ECONNREFUSED')]);

        expect(await capabilities.of('kokoro')).toBeUndefined();
        expect(logger.debug).toHaveBeenCalled();
    });

    it('answers nothing for an engine this server does not have', async () => {
        const { capabilities } = fakeSource([answering({ error: { code: 'unknown_engine', message: 'no' } }, 404)]);

        expect(await capabilities.of('nonesuch')).toBeUndefined();
    });

    it('answers nothing when something else is listening on the address', async () => {
        const { capabilities } = fakeSource([new Response('<html>hello</html>', { status: 200 })]);

        expect(await capabilities.of('kokoro')).toBeUndefined();
    });

    it('escapes an engine name rather than pasting it into the path', async () => {
        const { capabilities, urls } = fakeSource([answering(document())]);

        await capabilities.of('../../residency');

        expect(urls[0]).toBe(`${BASE_URL}/engines/..%2F..%2Fresidency/capabilities`);
    });
});

describe('effectiveVariant', () => {
    it('takes the one that was asked for', () => {
        const build = effectiveVariant(document({ variants: { turbo: variant({ cues: ['laugh'] }), original: variant() } }), 'turbo');

        expect(build?.cues).toEqual(['laugh']);
    });

    it('takes the loaded one when the request names none', () => {
        const loaded = document({
            current: {
                variant: 'original',
                cues: ['sigh'],
                deliveries: [],
                dials: {},
                cloning: { supported: false },
                streaming: { supported: true },
                nativeFormat: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 },
            },
            variants: { turbo: variant({ cues: ['laugh'] }), original: variant({ cues: ['sigh'] }) },
        });

        expect(effectiveVariant(loaded, undefined)?.cues).toEqual(['sigh']);
    });

    it('takes the first the engine lists when nothing at all is loaded', () => {
        // `current` is absent entirely on a cold worker, which is the state a station finds a server
        // in after a restart.
        const cold = document({ variants: { turbo: variant({ cues: ['laugh'] }), original: variant() } });

        expect(effectiveVariant(cold, undefined)?.cues).toEqual(['laugh']);
    });

    it('answers nothing for a variant this engine does not offer', () => {
        // Falling through to another build would be promising a reading the request is not going to
        // get: it will be refused for naming a variant that is not there.
        expect(effectiveVariant(document(), 'nonesuch')).toBeUndefined();
    });

    it('answers nothing without a document', () => {
        expect(effectiveVariant(undefined, 'turbo')).toBeUndefined();
    });
});

describe('what a build says it does', () => {
    it('keeps the cues the station has a name for', () => {
        expect(cuesOf(variant({ cues: ['laugh', 'sigh'] }))).toEqual(['laugh', 'sigh']);
    });

    it('drops a cue from a vocabulary newer than this station', () => {
        // Over-claiming is the failure that gets the word read out loud; under-claiming costs a
        // flourish.
        expect(cuesOf(variant({ cues: ['laugh', 'yawn'] }))).toEqual(['laugh']);
    });

    it('keeps the deliveries, on the same rule', () => {
        expect(deliveriesOf(variant({ deliveries: ['hushed', 'whispered', 'frantic'] }))).toEqual(['hushed', 'frantic']);
    });

    it('claims nothing for a build it could not read', () => {
        expect(cuesOf(undefined)).toEqual([]);
        expect(deliveriesOf(undefined)).toEqual([]);
        expect(maxCharactersOf(undefined)).toBeUndefined();
        expect(speedDialOf(undefined)).toBeUndefined();
    });

    it('reads a ceiling only when it is a usable one', () => {
        expect(maxCharactersOf(variant({ maxCharacters: 4096 }))).toBe(4096);
        expect(maxCharactersOf(variant())).toBeUndefined();
        expect(maxCharactersOf(variant({ maxCharacters: 0 }))).toBeUndefined();
        expect(maxCharactersOf(variant({ maxCharacters: -1 }))).toBeUndefined();
        expect(maxCharactersOf(variant({ maxCharacters: 12.5 }))).toBeUndefined();
    });

    it('finds the speed dial and leaves every other dial alone', () => {
        const build = variant({ dials: { speed: { min: 0.5, max: 2, default: 1 }, exaggeration: { min: 0, max: 1, default: 0.5 } } });

        expect(speedDialOf(build)).toEqual({ min: 0.5, max: 2, default: 1 });
    });

    it('ignores a speed dial with no usable range', () => {
        expect(speedDialOf(variant({ dials: { speed: { min: 2, max: 0.5, default: 1 } } }))).toBeUndefined();
    });
});

describe('speedWithin', () => {
    it('leaves a speed the dial accepts alone', () => {
        expect(speedWithin({ min: 0.5, max: 2, default: 1 }, 1.2)).toBe(1.2);
    });

    it('clamps rather than refusing, because an out-of-range dial would cost the break', () => {
        expect(speedWithin({ min: 0.5, max: 2, default: 1 }, 9)).toBe(2);
        expect(speedWithin({ min: 0.5, max: 2, default: 1 }, 0.1)).toBe(0.5);
    });
});
