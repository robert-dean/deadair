import { IsHttpError } from '@maroonedsoftware/errors';
import { describe, expect, it, vi } from 'vitest';
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
        keyFor: (pluginId: string, voiceId: string, spec?: string, text: string = SAMPLE_TEXT) =>
            `key:${pluginId}:${voiceId}${spec === undefined ? '' : `:${spec}`}${text === SAMPLE_TEXT ? '' : `:${text}`}`,
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
            { speaker, speakers, voices, speakAs, explainSpeaker } as never,
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
            segments: [READY, { id: 'b', kind: 'talkbreak', state: 'planned', label: 'the news', source: 'render', script: 'Good evening', pads: [] }],
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
