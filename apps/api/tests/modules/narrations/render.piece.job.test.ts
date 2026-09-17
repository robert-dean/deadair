// The one job in the tree that opens a production already written. Everything a model normally
// decides (the words, the beats, the speaker) is settled before this runs, so what is worth pinning
// is that it skips every writing pass, that a second render cannot speak the same chapter twice, and
// that every way it can fail ends up on the row rather than in a log.

import { describe, expect, it, vi } from 'vitest';

import { RenderPieceJob } from '../../../src/modules/narrations/render.piece.job.js';
import type { NarrationPieceRecord } from '../../../src/modules/narrations/narration.piece.js';

// The actor a job runs as needs a real scoped container, which none of these have and none of them
// are about. Every other job test in the tree mocks it for the same reason.
vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

const piece = (over: Partial<NarrationPieceRecord> = {}): NarrationPieceRecord => ({
    id: 'piece-1',
    seriesId: 'deadair.audiobook:frankenstein',
    pieceId: 'ch4',
    seriesTitle: 'Frankenstein',
    title: 'Chapter 4',
    seriesOrder: 'serial',
    renderAttempts: 0,
    seenAt: Date.now(),
    wordCount: 3_480,
    summary: 'The night it finally moves.',
    ...over,
});

interface Options {
    piece?: NarrationPieceRecord | undefined;
    text?: { parts: { text: string }[] } | undefined | 'throws';
    narrator?: { id: string; voice?: string } | undefined;
    claimedProduction?: boolean;
    moved?: boolean;
    installed?: boolean;
    maxCharacters?: number;
}

function build(options: Options = {}) {
    const pieces = {
        get: vi.fn(async () => (options.piece === undefined && 'piece' in options ? undefined : (options.piece ?? piece()))),
        markProduction: vi.fn(async () => options.claimedProduction ?? true),
        markRenderFailed: vi.fn(async () => {}),
    };

    const productions = {
        open: vi.fn(async () => ({ id: 'prod-1' })),
        moveTo: vi.fn(async () => options.moved ?? true),
        cancel: vi.fn(async () => true),
    };

    const planned: Record<string, unknown>[] = [];
    const segments = {
        plan: vi.fn(async (input: Record<string, unknown>) => {
            planned.push(input);
            return { id: `seg-${planned.length}` };
        }),
    };

    const personas = { presenting: vi.fn(async () => options.narrator ?? { id: 'persona-1', voice: 'host' }) };
    const speech = { maxCharacters: vi.fn(async () => options.maxCharacters ?? 3_000) };

    const instance = {
        listSeries: async () => [],
        listPieces: async () => [],
        getText: async () => {
            if (options.text === 'throws') throw new Error('the file could not be opened');
            return options.text === undefined && 'text' in options ? undefined : (options.text ?? { parts: [{ text: 'It was on a dreary night.' }] });
        },
    };
    const records = options.installed === false ? [] : [{ id: 'deadair.audiobook', status: 'active', manifest: { id: 'deadair.audiobook', capabilities: ['narration'] }, instance }];
    const pluginRegistry = { list: vi.fn(() => records) };
    const pluginInvoker = { invoke: vi.fn(async (_id: string, _name: string, run: () => Promise<unknown>) => await run()) };

    const jobs = { send: vi.fn(async () => {}) };

    const job = new RenderPieceJob(
        pieces as never,
        productions as never,
        segments as never,
        personas as never,
        speech as never,
        pluginRegistry as never,
        pluginInvoker as never,
        jobs as never,
        { id: 'job-1' } as never,
        {} as never,
        logger as never,
    );

    return { job, pieces, productions, segments, planned, jobs };
}

describe('RenderPieceJob', () => {
    it('opens a production and moves it straight to rendering, skipping every writing pass', async () => {
        // The author already wrote it. `planned → rendering` is a transition nothing else in the tree
        // makes, and it is the whole difference between this and a production the station writes.
        const { job, productions } = build();

        await job.run({ pieceId: 'piece-1' });

        expect(productions.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'narration', title: 'Chapter 4', writingMode: 'quick' }));
        expect(productions.moveTo).toHaveBeenCalledWith('prod-1', 'rendering', 'planned');
    });

    it('plants every part as a beat that is already written, in order', async () => {
        const { job, planned } = build({ text: { parts: [{ text: 'One.' }, { text: 'Two.' }] }, maxCharacters: 4 });

        await job.run({ pieceId: 'piece-1' });

        expect(planned).toHaveLength(2);
        expect(planned[0]).toMatchObject({ kind: 'narration', script: 'One.', productionId: 'prod-1', productionOrdinal: 0, voice: 'host' });
        expect(planned[1]).toMatchObject({ script: 'Two.', productionOrdinal: 1 });
    });

    it('marks each beat as a programme, so the mount names the piece rather than the station', async () => {
        const { job, planned } = build();

        await job.run({ pieceId: 'piece-1' });

        expect(planned[0]?.context).toMatchObject({
            programme: true,
            showTitle: 'Frankenstein',
            episodeTitle: 'Chapter 4',
            summary: 'The night it finally moves.',
        });
    });

    it('speaks the beats at background priority, so a break is never stuck behind a chapter', async () => {
        const { job, jobs } = build({ text: { parts: [{ text: 'One.' }, { text: 'Two.' }] }, maxCharacters: 4 });

        await job.run({ pieceId: 'piece-1' });

        expect(jobs.send).toHaveBeenCalledWith('render.segment', { segmentId: 'seg-1', priority: 'background' });
        expect(jobs.send).toHaveBeenCalledWith('render.segment', { segmentId: 'seg-2', priority: 'background' });
    });

    it('reads in the station default host voice rather than whoever is presenting now', async () => {
        // This runs hours ahead on whatever broadcast happens to be on, so reading the presenter off
        // the current show would give chapter three one voice and chapter four another. A series has
        // one reader, so the narrator is asked for with no lineup persona at all.
        const { job, planned } = build();

        await job.run({ pieceId: 'piece-1' });

        expect(planned[0]).toMatchObject({ voice: 'host', personaId: 'persona-1' });
    });

    it('cancels its own production when another render claimed the piece first', async () => {
        // Two renders that both got this far must not speak the same chapter into two piles of
        // segments; the row is the arbiter and the loser tidies up after itself.
        const { job, productions, segments } = build({ claimedProduction: false });

        await job.run({ pieceId: 'piece-1' });

        expect(productions.cancel).toHaveBeenCalledWith('prod-1');
        expect(segments.plan).not.toHaveBeenCalled();
    });

    it('does nothing at all for a piece that is already spoken', async () => {
        const { job, productions } = build({ piece: piece({ segmentId: 'seg-1' }) });

        await job.run({ pieceId: 'piece-1' });

        expect(productions.open).not.toHaveBeenCalled();
    });

    it('does nothing for a piece already being spoken', async () => {
        const { job, productions } = build({ piece: piece({ productionId: 'prod-0' }) });

        await job.run({ pieceId: 'piece-1' });

        expect(productions.open).not.toHaveBeenCalled();
    });
});

describe('RenderPieceJob when it cannot go on', () => {
    it('writes the reason on the row when the plugin cannot produce the words', async () => {
        const { job, pieces, productions } = build({ text: undefined, piece: piece() });
        (pieces.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(piece());

        await job.run({ pieceId: 'piece-1' });

        expect(pieces.markRenderFailed).toHaveBeenCalledWith('piece-1', expect.stringContaining('could not produce'));
        expect(productions.open).not.toHaveBeenCalled();
    });

    it('writes the reason on the row when reading the words threw', async () => {
        const { job, pieces } = build({ text: 'throws' });

        await job.run({ pieceId: 'piece-1' });

        expect(pieces.markRenderFailed).toHaveBeenCalledWith('piece-1', expect.stringContaining('could not be read'));
    });

    it('writes the reason on the row when the plugin is no longer installed', async () => {
        const { job, pieces } = build({ installed: false });

        await job.run({ pieceId: 'piece-1' });

        expect(pieces.markRenderFailed).toHaveBeenCalledWith('piece-1', expect.stringContaining('not installed'));
    });

    it('writes the reason on the row when the station has nobody to read it', async () => {
        const { job, pieces, productions } = build({ narrator: { id: 'persona-1' } });

        await job.run({ pieceId: 'piece-1' });

        expect(pieces.markRenderFailed).toHaveBeenCalledWith('piece-1', expect.stringContaining('nobody to read it'));
        expect(productions.open).not.toHaveBeenCalled();
    });

    it('writes the reason on the row when the piece turned out to have no words', async () => {
        const { job, pieces, productions } = build({ text: { parts: [{ text: '  ' }] } });

        await job.run({ pieceId: 'piece-1' });

        expect(pieces.markRenderFailed).toHaveBeenCalledWith('piece-1', expect.stringContaining('no words'));
        expect(productions.open).not.toHaveBeenCalled();
    });

    it('writes the reason on the row when the production could not be started', async () => {
        const { job, pieces } = build({ moved: false });

        await job.run({ pieceId: 'piece-1' });

        expect(pieces.markRenderFailed).toHaveBeenCalledWith('piece-1', expect.stringContaining('could not be started'));
    });

    it('does nothing for a send with no piece on it', async () => {
        const { job, productions } = build();

        await job.run({});

        expect(productions.open).not.toHaveBeenCalled();
    });
});
