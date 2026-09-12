import { IsHttpError } from '@maroonedsoftware/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginError } from '@deadair/plugin-sdk';
import type { SpeechVoice } from '@deadair/plugin-sdk';

import { RenderService } from '../../../src/modules/render/render.service.js';
import { SAMPLE_TEXT } from '../../../src/modules/render/voice.sample.store.js';
import type { SegmentLibrary } from '../../../src/modules/render/segment.library.js';
import type { Segment, SegmentRepository } from '../../../src/modules/render/segment.repository.js';
import type { SegmentStore } from '../../../src/modules/render/segment.store.js';

const ID = '11111111-1111-4111-8111-111111111111';
const CHECKSUM = 'a'.repeat(64);
const BYTES = Buffer.from('a station ident');

const READY: Segment = {
    id: ID,
    kind: 'ident',
    state: 'ready',
    label: 'top of the hour',
    source: 'library',
    pads: [],
    sourcePath: 'top-of-the-hour.mp3',
    audioChecksum: CHECKSUM,
    audioExt: 'mp3',
};

// A segment created through `POST /segments`, which hands over the words: what is missing is the
// audio, so it is born `written` rather than `planned`.
const PLANNED: Segment = {
    id: ID,
    kind: 'talkbreak',
    state: 'written',
    label: 'back-announce',
    source: 'render',
    pads: [],
    script: 'That was Boards of Canada.',
};

const SPEAKER = { record: { id: 'deadair.kokoro' } };

interface ServiceOptions {
    segment?: Segment;
    segments?: Segment[];
    bytes?: Buffer;
    planned?: Segment;
    /** `null` means nothing can speak. */
    speaker?: null;
    voices?: SpeechVoice[];
    sample?: Buffer;
    speakAs?: () => Promise<string>;
    /** What the history answers with. Absent leaves `page()` a stub that throws when it is called. */
    attempts?: unknown[];
    /** What the summary answers with. Absent leaves the counts a stub that throws when called. */
    counts?: unknown[];
    /** Which deliveries the speaker performs right now. Absent is none, which is most engines. */
    deliveries?: string[];
}

const service = (options: ServiceOptions = {}) => {
    const findById = vi.fn().mockResolvedValue(options.segment);
    const list = vi.fn().mockResolvedValue(options.segments ?? []);
    const read = vi.fn().mockResolvedValue(options.bytes);
    const scan = vi.fn().mockResolvedValue({ scanned: 1, imported: 1, skipped: 0 });
    const plan = vi.fn().mockResolvedValue(options.planned ?? PLANNED);
    const send = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    // `undefined`, not `null`: that is what the service checks for, and a fake answering
    // something else would test a branch the real code never takes.
    const speaker = vi.fn().mockReturnValue(options.speaker === null ? undefined : SPEAKER);
    const speakers = vi.fn().mockReturnValue(options.speaker === null ? [] : [SPEAKER]);
    const voices = vi.fn().mockResolvedValue(options.voices ?? []);
    const deliveriesOf = vi.fn().mockResolvedValue(options.deliveries ?? []);
    const speakAs = vi.fn(options.speakAs ?? (async () => 'mp3'));
    const sampleRead = vi.fn().mockResolvedValue(options.sample);
    // Why nobody can speak is SpeechService's sentence to write, and is tested there.
    const explainSpeaker = vi.fn().mockReturnValue('no active plugin can speak; install and enable a TTS plugin');

    const page = vi.fn(async () => {
        if (options.attempts === undefined) throw new Error('this suite does not read script history');
        return options.attempts;
    });

    const outcomeCountsSince = vi.fn(async () => {
        if (options.counts === undefined) throw new Error('this suite does not read the script summary');
        return options.counts;
    });

    const samples = {
        // The text rides the key exactly as the real store puts it there, so a case can tell one
        // script's file from another's — which is the whole of what a speech preview caches on.
        keyFor: (pluginId: string, voiceId: string, spec?: string, text: string = SAMPLE_TEXT, delivery?: string) =>
            `key:${pluginId}:${voiceId}${spec === undefined ? '' : `:${spec}`}${text === SAMPLE_TEXT ? '' : `:${text}`}${delivery === undefined ? '' : `:${delivery}`}`,
        extensions: ['mp3', 'wav'],
        read: sampleRead,
    };

    return {
        service: new RenderService(
            { findById, list, plan } as unknown as SegmentRepository,
            { read } as unknown as SegmentStore,
            {
                scan,
            } as unknown as SegmentLibrary,
            { send } as never,
            { speaker, speakers, voices, speakAs, explainSpeaker, deliveriesOf } as never,
            samples as never,
            // Script history is a read most of this suite never makes, so it stays a stub rather
            // than a fake unless a case hands over `attempts`: a page() nobody calls that throws is
            // a better failure than one that answers plausibly.
            { page, outcomeCountsSince } as never,
            // Ratings are only reached by `rateScript`, which this suite does not exercise: a stub
            // that throws on any call is a better failure than one that answers plausibly.
            {} as never,
            // The acting operator, for the one write that stamps who said so. Non-user leaves the
            // column empty, which is the ordinary state for anything not driven by a console.
            { actor: { kind: 'system' } } as never,
            // The lexicon is only reached through SpeechService, which this suite fakes whole, so
            // the repository itself is never called on any path here.
            {} as never,
            // The rack, its sets and its inbox, on the same terms: no case here reaches a pad route,
            // so a stub that throws on any call is a better failure than one that answers plausibly.
            {} as never,
            {} as never,
            {} as never,
            logger as never,
        ),
        findById,
        read,
        scan,
        plan,
        send,
        speakAs,
        sampleRead,
        voices,
        page,
        outcomeCountsSince,
    };
};

const status = async (promise: Promise<unknown>): Promise<number> => {
    try {
        await promise;
        return 200;
    } catch (error) {
        return IsHttpError(error) ? error.statusCode : 500;
    }
};

describe('RenderService.getSegmentAudio', () => {
    it('serves the bytes with the checksum as the validator', async () => {
        const { service: render, read } = service({ segment: READY, bytes: BYTES });

        const response = await render.getSegmentAudio(ID);

        expect(response.body).toEqual(BYTES);
        expect(response.headers.etag).toBe(`"${CHECKSUM}"`);
        expect(response.headers.cacheControl).toContain('max-age=');
        expect(read).toHaveBeenCalledWith(CHECKSUM, 'mp3');
    });

    it('404s an id nobody has', async () => {
        const { service: render, read } = service({ segment: undefined });

        expect(await status(render.getSegmentAudio(ID))).toBe(404);
        expect(read).not.toHaveBeenCalled();
    });

    // A segment with no audio is an ordinary state and not a fault: it is what everything the
    // station has not recorded yet looks like. The director skips one rather than asking for it,
    // so reaching this at all means a row changed under a commit.
    it('404s a segment that has no audio yet', async () => {
        const { service: render, read } = service({ segment: { ...READY, state: 'planned', audioChecksum: undefined, audioExt: undefined } });

        expect(await status(render.getSegmentAudio(ID))).toBe(404);
        expect(read).not.toHaveBeenCalled();
    });

    it('404s when the file has gone missing under the row', async () => {
        const { service: render } = service({ segment: READY, bytes: undefined });

        expect(await status(render.getSegmentAudio(ID))).toBe(404);
    });
});

describe('RenderService.listSegments', () => {
    it('says whether each segment can actually be played, rather than handing out a filename', async () => {
        const { service: render } = service({
            segments: [
                READY,
                { id: 'b', kind: 'talkbreak', state: 'planned', label: 'the news', source: 'render', script: 'Good evening', pads: [] },
            ],
        });

        const { segments } = await render.listSegments();

        expect(segments.map(s => s.playable)).toEqual([true, false]);
        expect(segments[0]).not.toHaveProperty('audioChecksum');
        expect(segments[1]?.script).toBe('Good evening');
    });
});

describe('RenderService.scanLibrary', () => {
    it('answers with what the pass did', async () => {
        const { service: render, scan } = service();

        expect(await render.scanLibrary()).toEqual({ scanned: 1, imported: 1, skipped: 0 });
        expect(scan).toHaveBeenCalledOnce();
    });
});

describe('RenderService.createSegment', () => {
    it('plans the segment and sends the job that speaks it', async () => {
        const { service: render, plan, send } = service();

        const created = await render.createSegment({ label: 'back-announce', script: 'That was Boards of Canada.' });

        expect(plan).toHaveBeenCalledWith({ kind: 'talkbreak', label: 'back-announce', script: 'That was Boards of Canada.' });
        expect(send).toHaveBeenCalledWith('render.segment', { segmentId: ID });
        // `written` is the answer, not an approximation of one: this route hands over the words, so
        // what is missing is the audio, and producing it is a job precisely because nobody is
        // waiting on it.
        expect(created.state).toBe('written');
        expect(created.playable).toBe(false);
    });

    it('carries the voice through, and leaves it out when there is none', async () => {
        const withVoice = service({ planned: { ...PLANNED, voice: 'newsreader' } });
        await withVoice.service.createSegment({ label: 'news', script: 'The headlines.', voice: 'newsreader' });
        expect(withVoice.plan).toHaveBeenCalledWith(expect.objectContaining({ voice: 'newsreader' }));

        const without = service();
        await without.service.createSegment({ label: 'back-announce', script: 'That was that.' });
        expect(without.plan).toHaveBeenCalledWith(expect.not.objectContaining({ voice: expect.anything() }));
    });

    it('carries a delivery through, and plans none when there is none', async () => {
        const hushed = service({ planned: { ...PLANNED, delivery: 'hushed' } });
        const created = await hushed.service.createSegment({ label: 'late', script: 'Quiet now.', delivery: 'hushed' });
        expect(hushed.plan).toHaveBeenCalledWith(expect.objectContaining({ delivery: 'hushed' }));
        expect(created.delivery).toBe('hushed');

        const ordinary = service();
        await ordinary.service.createSegment({ label: 'back-announce', script: 'That was that.' });
        expect(ordinary.plan).toHaveBeenCalledWith(expect.not.objectContaining({ delivery: expect.anything() }));
    });

    it('refuses a delivery the station has no word for, rather than planting an ordinary reading', async () => {
        // The contract types it as a string so a new reading is not a breaking change in four
        // generated clients. This is where the vocabulary is held, and before anything is written.
        const { service: render, plan } = service();

        expect(await status(render.createSegment({ label: 'x', script: 'Loud.', delivery: 'shouty' }))).toBe(400);
        expect(plan).not.toHaveBeenCalled();
    });

    it('takes the kind the caller asked for', async () => {
        const { service: render, plan } = service();

        await render.createSegment({ label: 'top of the hour', script: 'This is Deadair.', kind: 'ident' });

        expect(plan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ident' }));
    });

    it('writes the row before sending the job', async () => {
        // A job that ran before the row was committed would find nothing to claim.
        const order: string[] = [];
        const { service: render, plan, send } = service();
        plan.mockImplementation(async () => {
            order.push('plan');
            return PLANNED;
        });
        send.mockImplementation(async () => {
            order.push('send');
        });

        await render.createSegment({ label: 'back-announce', script: 'That was that.' });

        expect(order).toEqual(['plan', 'send']);
    });
});

describe('RenderService.listVoices', () => {
    it('reports the voices and which plugin answered', async () => {
        const { service: render } = service({ voices: [{ id: 'host', label: 'Station host' }] });

        expect(await render.listVoices()).toEqual({ voices: [{ id: 'host', label: 'Station host' }], pluginId: 'deadair.kokoro' });
    });

    it('leaves the spec behind, because it is a cache key and not a field of the contract', async () => {
        // The host does not interpret it and nobody outside the render module has a use for it. A
        // plain pass-through would compile and put it on the wire, since an excess property check
        // does not reach a variable.
        const { service: render } = service({ voices: [{ id: 'host', label: 'Station host', spec: 'af_heart@1' }] });

        expect(await render.listVoices()).toEqual({ voices: [{ id: 'host', label: 'Station host' }], pluginId: 'deadair.kokoro' });
    });

    it('says which deliveries the engine performs, and says nothing when it is none', async () => {
        const reading = service({ voices: [{ id: 'host', label: 'Station host' }], deliveries: ['hushed', 'frantic'] });
        expect((await reading.service.listVoices()).deliveries).toEqual(['hushed', 'frantic']);

        const plain = service({ voices: [{ id: 'host', label: 'Station host' }] });
        expect(await plain.service.listVoices()).not.toHaveProperty('deliveries');
    });

    it('answers an empty list with a reason rather than failing', async () => {
        // A console drawing an empty list wants to explain it; a 503 would leave it guessing.
        const { service: render } = service({ speaker: null });

        const result = await render.listVoices();

        expect(result.voices).toEqual([]);
        expect(result.reason).toMatch(/install and enable/);
        expect(result.pluginId).toBeUndefined();
    });
});

describe('RenderService.getVoiceSample', () => {
    it('renders on a miss and serves what came back', async () => {
        const { service: render, speakAs, sampleRead } = service();
        sampleRead.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValue(Buffer.from('spoken'));

        const response = await render.getVoiceSample('host');

        expect(speakAs).toHaveBeenCalledWith(
            SPEAKER,
            'key:deadair.kokoro:host',
            expect.anything(),
            { text: SAMPLE_TEXT, voice: 'host' },
            // A preview is the one speech caller that gives up rather than waiting, and the one
            // that queues behind the station: there is an operator on the other end of it, and a
            // break about to air matters more than the voice they are auditioning.
            { maxWaitMs: expect.any(Number), priority: 'preview' },
        );
        expect(response.contentType).toBe('audio/mpeg');
        expect(response.body).toEqual(Buffer.from('spoken'));
    });

    it('serves a hit without asking the engine again', async () => {
        // The whole point of the cache: the first click waits for a synthesis and no later one does.
        const { service: render, speakAs } = service({ sample: Buffer.from('already rendered') });

        const response = await render.getVoiceSample('host');

        expect(speakAs).not.toHaveBeenCalled();
        expect(response.body).toEqual(Buffer.from('already rendered'));
    });

    it('validates on the cache key, so a remapped voice is a different ETag', async () => {
        const { service: render } = service({ sample: Buffer.from('already rendered') });

        expect((await render.getVoiceSample('host')).headers.etag).toBe('"key:deadair.kokoro:host"');
    });

    it('keys the sample on what the plugin says the voice currently IS', async () => {
        // The whole reason the sample path asks for the voice LIST before rendering one of them.
        // Without it the key holds `host`, which is exactly the part that does not change when an
        // operator edits the mapping under it — so a remap served the old voice back forever.
        const { service: render } = service({
            sample: Buffer.from('already rendered'),
            voices: [{ id: 'host', label: 'Station host', spec: 'bm_george@0.95' }],
        });

        expect((await render.getVoiceSample('host')).headers.etag).toBe('"key:deadair.kokoro:host:bm_george@0.95"');
    });

    it('keys as it always did when the plugin lists the voice without a spec', async () => {
        const { service: render } = service({
            sample: Buffer.from('already rendered'),
            voices: [{ id: 'host', label: 'Station host' }],
        });

        expect((await render.getVoiceSample('host')).headers.etag).toBe('"key:deadair.kokoro:host"');
    });

    it('still renders when the voice list cannot be read at all', async () => {
        // A preview must never 502 over its own cache name. The worst case is the caching behaviour
        // that shipped before `spec` existed.
        const { service: render, voices } = service({ sample: Buffer.from('already rendered') });
        voices.mockRejectedValue(new Error('the engine is down'));

        expect((await render.getVoiceSample('host')).headers.etag).toBe('"key:deadair.kokoro:host"');
    });

    it('asks for the plugin default when no voice is named, rather than for a voice called ""', async () => {
        const { service: render, speakAs, sampleRead } = service();
        sampleRead.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValue(Buffer.from('spoken'));

        await render.getVoiceSample('');

        expect(speakAs).toHaveBeenCalledWith(
            SPEAKER,
            'key:deadair.kokoro:',
            expect.anything(),
            { text: SAMPLE_TEXT },
            { maxWaitMs: expect.any(Number), priority: 'preview' },
        );
    });

    it('answers 503 when nothing can speak', async () => {
        const { service: render } = service({ speaker: null });

        expect(await status(render.getVoiceSample('host'))).toBe(503);
    });

    it('answers 502 when the engine refuses', async () => {
        const { service: render, sampleRead } = service({
            speakAs: async () => {
                throw new Error('the engine is down');
            },
        });
        sampleRead.mockResolvedValue(undefined);

        // Not a 404: the voice asked for is fine, the station is not.
        expect(await status(render.getVoiceSample('host'))).toBe(502);
    });
});

describe('RenderService.getDefaultVoiceSample', () => {
    // The row an operator is most likely to press first answered 404 for as long as the voices page
    // existed, because the id of the plugin's own default is the empty string and `/voices//sample`
    // is not that route with a blank id — it is a URL matching nothing. The service never had the
    // problem; only the path could not say it.
    it('asks the plugin for its own default rather than for a voice called nothing', async () => {
        const { service: render, speakAs, sampleRead } = service();
        sampleRead.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValue(Buffer.from('spoken'));

        const response = await render.getDefaultVoiceSample();

        expect(speakAs).toHaveBeenCalledWith(SPEAKER, expect.any(String), expect.anything(), { text: SAMPLE_TEXT }, expect.anything());
        expect(response.body).toEqual(Buffer.from('spoken'));
    });

    it('is the same sample the empty voice id has always keyed, so nothing re-renders', async () => {
        const { service: render } = service({ sample: Buffer.from('already rendered') });

        expect((await render.getDefaultVoiceSample()).headers.etag).toBe((await render.getVoiceSample('')).headers.etag);
    });

    it('is not the same sample as any named voice', async () => {
        const { service: render } = service({ sample: Buffer.from('already rendered') });

        expect((await render.getDefaultVoiceSample()).headers.etag).not.toBe((await render.getVoiceSample('host')).headers.etag);
    });
});

describe('RenderService.previewSpeech', () => {
    it('speaks the words it was given, in the voice it was given', async () => {
        const { service: render, speakAs, sampleRead } = service();
        sampleRead.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValue(Buffer.from('spoken'));

        const response = await render.previewSpeech({ text: 'Still here, still listening.', voice: 'host' });

        expect(speakAs).toHaveBeenCalledWith(
            SPEAKER,
            'key:deadair.kokoro:host:Still here, still listening.',
            expect.anything(),
            { text: 'Still here, still listening.', voice: 'host' },
            // Behind every break the station is about to air, and giving up rather than waiting
            // forever: there is an operator on the other end and a show on the other.
            { maxWaitMs: expect.any(Number), priority: 'preview' },
        );
        expect(response.contentType).toBe('audio/mpeg');
        expect(response.body).toEqual(Buffer.from('spoken'));
    });

    it('asks for the plugin default when no voice is named, rather than for a voice called nothing', async () => {
        const { service: render, speakAs, sampleRead } = service();
        sampleRead.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValue(Buffer.from('spoken'));

        await render.previewSpeech({ text: 'One line.' });

        expect(speakAs).toHaveBeenCalledWith(SPEAKER, expect.any(String), expect.anything(), { text: 'One line.' }, expect.anything());
    });

    it('serves a hit without asking the engine again, so replaying one line is free', async () => {
        const { service: render, speakAs } = service({ sample: Buffer.from('already rendered') });

        const response = await render.previewSpeech({ text: 'One line.', voice: 'host' });

        expect(speakAs).not.toHaveBeenCalled();
        expect(response.body).toEqual(Buffer.from('already rendered'));
    });

    it('keys two scripts in one voice as two files', async () => {
        const { service: render, speakAs, sampleRead } = service();
        sampleRead.mockResolvedValue(undefined);

        await render.previewSpeech({ text: 'One line.', voice: 'host' }).catch(() => undefined);
        await render.previewSpeech({ text: 'A different line.', voice: 'host' }).catch(() => undefined);

        const keys = (speakAs.mock.calls as unknown as unknown[][]).map(call => call[1]);
        expect(keys).toHaveLength(2);
        expect(keys[0]).not.toBe(keys[1]);
    });

    it('reads the words the way it was asked, and keys that reading as its own file', async () => {
        const { service: render, speakAs, sampleRead } = service({ deliveries: ['hushed', 'frantic'] });
        sampleRead.mockResolvedValue(undefined);

        await render.previewSpeech({ text: 'One line.', voice: 'host', delivery: 'frantic' }).catch(() => undefined);
        await render.previewSpeech({ text: 'One line.', voice: 'host' }).catch(() => undefined);

        const calls = speakAs.mock.calls as unknown as unknown[][];
        expect(calls[0]?.[3]).toEqual({ text: 'One line.', voice: 'host', delivery: 'frantic' });
        expect(calls[0]?.[1]).toBe('key:deadair.kokoro:host:One line.:frantic');
        expect(calls[1]?.[1]).toBe('key:deadair.kokoro:host:One line.');
    });

    it('keys a delivery the engine does not perform as the ordinary reading it will actually get', async () => {
        // Keyed on what was asked, an ordinary reading would be filed under `frantic` and served back
        // after the operator switched to a model that does perform it.
        const { service: render, speakAs, sampleRead } = service();
        sampleRead.mockResolvedValue(undefined);

        await render.previewSpeech({ text: 'One line.', voice: 'host', delivery: 'frantic' }).catch(() => undefined);

        const calls = speakAs.mock.calls as unknown as unknown[][];
        expect(calls[0]?.[1]).toBe('key:deadair.kokoro:host:One line.');
        expect(calls[0]?.[3]).toEqual({ text: 'One line.', voice: 'host' });
    });

    it('refuses a delivery the station has no word for', async () => {
        const { service: render, speakAs } = service({ deliveries: ['hushed', 'frantic'] });

        expect(await status(render.previewSpeech({ text: 'One line.', delivery: 'shouty' }))).toBe(400);
        expect(speakAs).not.toHaveBeenCalled();
    });

    it('answers 503 when nothing can speak, because that is the station and not the words', async () => {
        const { service: render } = service({ speaker: null });

        expect(await status(render.previewSpeech({ text: 'One line.' }))).toBe(503);
    });

    it('answers 503 when the engine is busy, which comes right on its own', async () => {
        const busy = new PluginError('the speech gate is busy').withCode('timeout');
        const { service: render, sampleRead } = service({
            speakAs: () => Promise.reject(busy),
        });
        sampleRead.mockResolvedValue(undefined);

        expect(await status(render.previewSpeech({ text: 'One line.' }))).toBe(503);
    });

    it('answers 502 when the engine refused, which does not', async () => {
        const { service: render, sampleRead } = service({
            speakAs: () => Promise.reject(new Error('the engine said no')),
        });
        sampleRead.mockResolvedValue(undefined);

        expect(await status(render.previewSpeech({ text: 'One line.' }))).toBe(502);
    });

    // A preview leaves no ETag and asks for none: nothing re-fetches a POST, and the cache that
    // matters is the file the key already found.
    it('carries no cache headers', async () => {
        const { service: render } = service({ sample: Buffer.from('already rendered') });

        expect(await render.previewSpeech({ text: 'One line.' })).toEqual({
            contentType: 'audio/mpeg',
            body: Buffer.from('already rendered'),
        });
    });
});

describe('RenderService.readScriptSummary', () => {
    // The window is the whole meaning of the numbers: "5 declined" over an hour and over a week are
    // opposite readings, so a default that did not reach the repository would count something other
    // than what the console says it is drawing.
    it('counts a day when the caller names no window', async () => {
        const { service: render, outcomeCountsSince } = service({ counts: [] });

        await render.readScriptSummary({});

        expect(outcomeCountsSince).toHaveBeenCalledWith(24);
    });

    it('counts the window the caller named', async () => {
        const { service: render, outcomeCountsSince } = service({ counts: [] });

        await render.readScriptSummary({ hours: 72 });

        expect(outcomeCountsSince).toHaveBeenCalledWith(72);
    });

    // Echoed rather than left to the caller's memory: a console that assumed the default it did not
    // send would label the numbers with a window nobody counted.
    it('says which window it counted', async () => {
        const { service: render } = service({ counts: [] });

        await expect(render.readScriptSummary({})).resolves.toEqual({ hours: 24, rows: [] });
        await expect(render.readScriptSummary({ hours: 6 })).resolves.toEqual({ hours: 6, rows: [] });
    });

    it('answers with the rows as the repository counted them', async () => {
        const rows = [{ personaKey: 'pirate', written: 3, declined: 1, failed: 0 }];
        const { service: render } = service({ counts: rows });

        await expect(render.readScriptSummary({})).resolves.toEqual({ hours: 24, rows });
    });
});

describe('RenderService.readScriptHistory', () => {
    // Every filter is a passthrough and this is the one that arrives from a link rather than from a
    // control an operator can see, so a query that quietly dropped it would answer with the whole
    // history under a heading saying it was one break.
    it('narrows the history to one break when the caller names a segment', async () => {
        const { service: render, page } = service({ attempts: [] });

        await render.readScriptHistory({ segmentId: 'seg_1', limit: 10 });

        expect(page).toHaveBeenCalledWith(expect.objectContaining({ segmentId: 'seg_1', limit: 10 }));
    });

    it('asks for the whole history when it names none', async () => {
        const { service: render, page } = service({ attempts: [] });

        await render.readScriptHistory({});

        expect(page).toHaveBeenCalledWith(expect.not.objectContaining({ segmentId: expect.anything() }));
    });
});

// The console door onto the rack. What is under test is the READING of a multipart body — what a
// name comes from, what an extension comes from, what is refused — because `PadLibrary.ingest`
// beyond it has its own suite and the parser itself belongs to the server framework.
describe('RenderService.uploadPad', () => {
    const FILE = { field: 'file', filename: 'Air Horn (2).wav', mimeType: 'audio/wav', bytes: Buffer.from('a drop') };

    /** A parsed multipart body, as the generated router hands one over. */
    const body = (parts: { fields?: Record<string, string>; file?: typeof FILE | undefined }) =>
        ({
            parse: async (handler: (field: string, stream: unknown, filename: string, encoding: string, mimeType: string) => Promise<void>) => {
                const file = parts.file === undefined ? undefined : parts.file;
                if (file !== undefined) {
                    // One chunk, which is all this needs: the service concatenates whatever the
                    // stream yields and the chunking is busboy's business rather than its own.
                    await handler(file.field, [file.bytes], file.filename, '7bit', file.mimeType);
                }

                return new Map(
                    Object.entries(parts.fields ?? {}).map(([key, value]) => [
                        key,
                        { value, nameTruncated: false, valueTruncated: false, encoding: '7bit', mimeType: 'text/plain' },
                    ]),
                );
            },
        }) as never;

    const uploader = (ingest = vi.fn(async () => ({ pad: { id: 'pad-1', name: 'airhorn' }, outcome: 'created', contested: false }))) => {
        const render = new RenderService(
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { list: vi.fn(async () => []) } as never,
            { list: vi.fn(async () => []), setsFor: vi.fn(async () => new Map()), personasNaming: vi.fn(async () => []) } as never,
            { ingest } as never,
            { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        );

        return { service: render, ingest };
    };

    it('derives the token and the label from the filename when nobody says otherwise', async () => {
        const { service: render, ingest } = uploader();

        await render.uploadPad(body({ file: FILE, fields: { board: 'wisecrack' } }));

        expect(ingest).toHaveBeenCalledWith(
            expect.objectContaining({ board: 'wisecrack', name: 'air-horn-2', label: 'Air Horn (2)', ext: 'wav', source: 'upload' }),
        );
    });

    it('normalises a name the operator typed exactly as it would a filename', async () => {
        const { service: render, ingest } = uploader();

        // Or the one door produces `Air Horn` and the other `air-horn`, and the station holds two
        // pads where somebody added one.
        await render.uploadPad(body({ file: FILE, fields: { name: 'Air Horn' } }));

        expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ name: 'air-horn' }));
    });

    it('lands on the station board when nobody names one', async () => {
        const { service: render, ingest } = uploader();

        await render.uploadPad(body({ file: FILE }));

        expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ board: 'station' }));
    });

    it('falls back to the declared media type for a file whose name carries no extension', async () => {
        const { service: render, ingest } = uploader();

        await render.uploadPad(body({ file: { ...FILE, filename: 'airhorn', mimeType: 'audio/mpeg' } }));

        expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ ext: 'mp3', name: 'airhorn' }));
    });

    it('refuses a format the store cannot serve rather than filing it', async () => {
        const { service: render, ingest } = uploader();

        expect(await status(render.uploadPad(body({ file: { ...FILE, filename: 'airhorn.aiff', mimeType: 'audio/aiff' } })))).toBe(415);
        expect(ingest).not.toHaveBeenCalled();
    });

    it('refuses an upload carrying no audio at all', async () => {
        const { service: render, ingest } = uploader();

        expect(await status(render.uploadPad(body({ fields: { board: 'wisecrack' } })))).toBe(400);
        expect(ingest).not.toHaveBeenCalled();
    });

    it('refuses a name with nothing left in it, because a script has to be able to write one', async () => {
        const { service: render, ingest } = uploader();

        expect(await status(render.uploadPad(body({ file: FILE, fields: { name: '---' } })))).toBe(400);
        expect(ingest).not.toHaveBeenCalled();
    });

    it('refuses a board that would write outside the library', async () => {
        const { service: render, ingest } = uploader();

        expect(await status(render.uploadPad(body({ file: FILE, fields: { board: '../../etc' } })))).toBe(400);
        expect(ingest).not.toHaveBeenCalled();
    });

    it('says so when the set already answers to that name, because the sound is kept and unreachable', async () => {
        const contested = vi.fn(async () => ({ pad: { id: 'pad-1', name: 'airhorn' }, outcome: 'created', contested: true }));
        const { service: render } = uploader(contested);

        expect(await status(render.uploadPad(body({ file: FILE, fields: { board: 'wisecrack' } })))).toBe(409);
    });
});

// The one thing `pads.source` decides. A file the console wrote it may take away; a file the operator
// dropped in the library is theirs, and deleting the row would only bring it back on the next scan.
describe('RenderService.deletePad', () => {
    const pad = (source: string) => ({ id: ID, name: 'airhorn', label: 'Air Horn', source, sourcePath: `station/airhorn.wav` });

    const deleter = (source: string) => {
        const findById = vi.fn(async () => pad(source));
        const remove = vi.fn(async () => true);
        const discard = vi.fn(async () => undefined);

        const render = new RenderService(
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { findById, remove, list: vi.fn(async () => []) } as never,
            { list: vi.fn(async () => []), setsFor: vi.fn(async () => new Map()), personasNaming: vi.fn(async () => []) } as never,
            { discard } as never,
            { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        );

        return { service: render, remove, discard };
    };

    it('takes the row and the file together, because the scan re-reads the directory', async () => {
        const { service: render, remove, discard } = deleter('upload');

        await render.deletePad(ID);

        // Both, and in that order of importance: a row removed on its own comes straight back on the
        // next pass, because the file is still there making the same claim.
        expect(discard).toHaveBeenCalled();
        expect(remove).toHaveBeenCalledWith(ID);
    });

    it('does the same for one fetched from an address', async () => {
        const { service: render, remove } = deleter('url');

        await render.deletePad(ID);

        expect(remove).toHaveBeenCalled();
    });

    it('refuses a file the operator dropped in themselves, and says what to do instead', async () => {
        const { service: render, remove, discard } = deleter('library');

        expect(await status(render.deletePad(ID))).toBe(409);
        expect(remove).not.toHaveBeenCalled();
        expect(discard).not.toHaveBeenCalled();
    });
});

// The third door. What is under test is the bounding — a body counted as it arrives rather than
// trusted from a header — and the refusals, because everything past `ingest` is covered next door.
describe('RenderService.fetchPad', () => {
    const fetcher = (answer: () => Promise<Response>) => {
        const ingest = vi.fn(async () => ({ pad: { id: 'pad-1', name: 'airhorn' }, outcome: 'created', contested: false }));
        vi.stubGlobal('fetch', vi.fn(answer));

        const render = new RenderService(
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { list: vi.fn(async () => []) } as never,
            { list: vi.fn(async () => []), setsFor: vi.fn(async () => new Map()), personasNaming: vi.fn(async () => []) } as never,
            { ingest } as never,
            { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        );

        return { service: render, ingest };
    };

    /** An upstream handing back one chunk of the given size, with no content-length at all. */
    const answering =
        (bytes: number, type = 'audio/wav') =>
        async () =>
            new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': type } });

    afterEach(() => vi.unstubAllGlobals());

    it('takes what comes back and files it as fetched', async () => {
        const { service: render, ingest } = fetcher(answering(64));

        // Percent-encoded, which is what an address to a file with a space in its name looks like.
        // Read raw it normalises to `air-20horn`, a token nobody would type and nothing would guess.
        await render.fetchPad({ url: 'https://example.com/sounds/Air%20Horn.wav', board: 'wisecrack' });

        expect(ingest).toHaveBeenCalledWith(
            expect.objectContaining({ board: 'wisecrack', ext: 'wav', source: 'url', name: 'air-horn', label: 'Air Horn' }),
        );
    });

    it('stops at the ceiling rather than buffering whatever the far end sends', async () => {
        // No content-length on the response above, which is the point: the size is counted as the
        // chunks arrive, because a header is a claim the far end makes and may not make at all.
        const { service: render, ingest } = fetcher(answering(26 * 1024 * 1024));

        expect(await status(render.fetchPad({ url: 'https://example.com/bed.wav', board: 'station' }))).toBe(413);
        expect(ingest).not.toHaveBeenCalled();
    });

    it('refuses a format the store cannot serve', async () => {
        const { service: render, ingest } = fetcher(
            async () => new Response(new Uint8Array(8), { status: 200, headers: { 'content-type': 'text/html' } }),
        );

        expect(await status(render.fetchPad({ url: 'https://example.com/airhorn', board: 'station' }))).toBe(415);
        expect(ingest).not.toHaveBeenCalled();
    });

    it("answers 502 for an address that refused, rather than reporting it as the operator's mistake", async () => {
        const { service: render } = fetcher(async () => new Response('nope', { status: 404 }));

        expect(await status(render.fetchPad({ url: 'https://example.com/airhorn.wav', board: 'station' }))).toBe(502);
    });

    it('answers 502 for an address that could not be reached at all', async () => {
        const { service: render } = fetcher(async () => {
            throw new Error('getaddrinfo ENOTFOUND');
        });

        expect(await status(render.fetchPad({ url: 'https://example.invalid/airhorn.wav', board: 'station' }))).toBe(502);
    });

    it('refuses a board that would write outside the library before it fetches anything', async () => {
        const { service: render } = fetcher(answering(64));

        expect(await status(render.fetchPad({ url: 'https://example.com/airhorn.wav', board: '../../etc' }))).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });
});

// The console door onto the segment library. Thinner than the pad case beside it because a segment
// carries no token a script writes: the filename only ever becomes a LABEL, so what is left to check
// is the extension, the kind, and that a repeat is not treated as a mistake.
describe('RenderService.uploadSegment', () => {
    const FILE = { field: 'file', filename: 'Top of the hour.wav', mimeType: 'audio/wav', bytes: Buffer.from('a recording') };

    const body = (parts: { fields?: Record<string, string>; file?: typeof FILE | undefined }) =>
        ({
            parse: async (handler: (field: string, stream: unknown, filename: string, encoding: string, mimeType: string) => Promise<void>) => {
                if (parts.file !== undefined) {
                    await handler(parts.file.field, [parts.file.bytes], parts.file.filename, '7bit', parts.file.mimeType);
                }

                return new Map(
                    Object.entries(parts.fields ?? {}).map(([key, value]) => [
                        key,
                        { value, nameTruncated: false, valueTruncated: false, encoding: '7bit', mimeType: 'text/plain' },
                    ]),
                );
            },
        }) as never;

    const uploader = (created = true) => {
        const ingest = vi.fn(async () => ({ segment: { ...READY, id: ID }, created }));

        const render = new RenderService(
            {} as never,
            {} as never,
            { ingest } as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        );

        return { service: render, ingest };
    };

    it('files it under the kind it was given, with the filename as its label', async () => {
        const { service: render, ingest } = uploader();

        await render.uploadSegment(body({ file: FILE, fields: { kind: 'ident' } }));

        expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ident', label: 'Top of the hour', ext: 'wav' }));
    });

    it('lands on the ident kind when nobody names one', async () => {
        const { service: render, ingest } = uploader();

        await render.uploadSegment(body({ file: FILE }));

        expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ident' }));
    });

    it('takes a label the operator typed over the one the filename gives', async () => {
        const { service: render, ingest } = uploader();

        // What goes on the mount as the title while it airs, so it reaches a listener rather than
        // only the console.
        await render.uploadSegment(body({ file: FILE, fields: { label: 'Top of the hour (new)' } }));

        expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ label: 'Top of the hour (new)' }));
    });

    it('answers with the segment the station already held rather than refusing a repeat', async () => {
        // Dropping the same recording in twice is one segment either way: `importFile` dedups on the
        // checksum, so there is nothing here to report as an error.
        const { service: render } = uploader(false);

        expect(await status(render.uploadSegment(body({ file: FILE })))).toBe(200);
    });

    it('refuses a format the store cannot serve rather than filing it', async () => {
        const { service: render, ingest } = uploader();

        expect(await status(render.uploadSegment(body({ file: { ...FILE, filename: 'ident.aiff', mimeType: 'audio/aiff' } })))).toBe(415);
        expect(ingest).not.toHaveBeenCalled();
    });

    it('refuses an upload carrying no audio at all', async () => {
        const { service: render, ingest } = uploader();

        expect(await status(render.uploadSegment(body({ fields: { kind: 'ident' } })))).toBe(400);
        expect(ingest).not.toHaveBeenCalled();
    });

    it('refuses a kind that would write outside the inbox', async () => {
        const { service: render, ingest } = uploader();

        expect(await status(render.uploadSegment(body({ file: FILE, fields: { kind: '../../etc' } })))).toBe(400);
        expect(ingest).not.toHaveBeenCalled();
    });
});

// The one asymmetry with the soundboard: a pad can be turned down, so refusing to delete an
// operator's own file costs nothing there. A segment has no such state, so refusing here would leave
// an unwanted ident unremovable and still bookable by a format-clock band.
describe('RenderService.deleteSegment', () => {
    const deleter = (segment: Segment | undefined) => {
        const findById = vi.fn(async () => segment);
        const remove = vi.fn(async () => true);
        const discard = vi.fn(async () => undefined);
        const list = vi.fn(async () => []);

        const render = new RenderService(
            { findById, remove, list } as unknown as SegmentRepository,
            {} as never,
            { discard } as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        );

        return { service: render, remove, discard };
    };

    it('takes the row and the inbox file together, because the scan re-reads the directory', async () => {
        const { service: render, remove, discard } = deleter(READY);

        await render.deleteSegment(ID);

        expect(discard).toHaveBeenCalled();
        expect(remove).toHaveBeenCalledWith(ID);
    });

    it('refuses something the station wrote and spoke for itself', async () => {
        // Named by the running order and recorded in `script_history`, and the way to have it again
        // is a re-render rather than a re-upload. There is nothing on disk to take away either.
        const { service: render, remove, discard } = deleter({ ...READY, source: 'render' });

        expect(await status(render.deleteSegment(ID))).toBe(409);
        expect(remove).not.toHaveBeenCalled();
        expect(discard).not.toHaveBeenCalled();
    });

    it('answers 404 for an id nobody has', async () => {
        const { service: render } = deleter(undefined);

        expect(await status(render.deleteSegment(ID))).toBe(404);
    });
});
