import { IsHttpError } from '@maroonedsoftware/errors';
import { describe, expect, it, vi } from 'vitest';

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
    voices?: { id: string; label: string }[];
    sample?: Buffer;
    speakAs?: () => Promise<string>;
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
        throw new Error('this suite does not read script history');
    });

    const samples = {
        keyFor: (pluginId: string, voiceId: string) => `key:${pluginId}:${voiceId}`,
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
            // Script history is a read this suite never makes, so it is a stub rather than a fake:
            // a page() nobody calls that throws is a better failure than one that answers plausibly.
            { page } as never,
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
            segments: [READY, { id: 'b', kind: 'talkbreak', state: 'planned', label: 'the news', source: 'render', script: 'Good evening' }],
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

        expect(speakAs).toHaveBeenCalledWith(SPEAKER, 'key:deadair.kokoro:host', expect.anything(), {
            text: SAMPLE_TEXT,
            voice: 'host',
        });
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

    it('asks for the plugin default when no voice is named, rather than for a voice called ""', async () => {
        const { service: render, speakAs, sampleRead } = service();
        sampleRead.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValue(Buffer.from('spoken'));

        await render.getVoiceSample('');

        expect(speakAs).toHaveBeenCalledWith(SPEAKER, 'key:deadair.kokoro:', expect.anything(), { text: SAMPLE_TEXT });
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
