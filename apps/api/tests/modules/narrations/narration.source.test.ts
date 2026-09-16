// What a `narration` band reads, and every way it declines. The planner and the scheduler ask the
// same question through this, which is what makes the chapter spoken for ten the chapter aired at ten.

import { describe, expect, it, vi } from 'vitest';

import { NarrationSource, WORDS_PER_MINUTE } from '../../../src/modules/narrations/narration.source.js';
import type { NarrationPieceRecord } from '../../../src/modules/narrations/narration.piece.js';

const piece = (over: Partial<NarrationPieceRecord> = {}): NarrationPieceRecord => ({
    id: 'piece-1',
    seriesId: 'deadair.audiobook:frankenstein',
    pieceId: 'ch4',
    seriesTitle: 'Frankenstein',
    title: 'Chapter 4',
    seriesOrder: 'serial',
    renderAttempts: 0,
    seenAt: Date.now(),
    ...over,
});

const SUBJECT = { id: 't1', key: 'frankenstein', label: 'Frankenstein' };

function build(options: { topics?: unknown[]; next?: NarrationPieceRecord; segment?: { durationMs?: number } } = {}) {
    const topics = {
        list: vi.fn(async () => options.topics ?? [{ id: 't1', kind: 'narration', config: { series: 'deadair.audiobook:frankenstein' } }]),
    };
    const pieces = { nextFor: vi.fn(async () => options.next) };
    const segments = { findById: vi.fn(async () => options.segment) };

    return { source: new NarrationSource(topics as never, pieces as never, segments as never), pieces };
}

describe('NarrationSource', () => {
    it('answers with the segment and the length the mixer measured', async () => {
        const { source } = build({ next: piece({ segmentId: 'seg-1', wordCount: 3_480 }), segment: { durationMs: 612_000 } });

        expect(await source.segmentFor(SUBJECT, new Set())).toEqual({ segmentId: 'seg-1', durationMs: 612_000 });
    });

    it('estimates the length from the word count when the audio reports none', async () => {
        // Never nothing: a chapter that projects as zero puts the news twenty minutes into it.
        const { source } = build({ next: piece({ segmentId: 'seg-1', wordCount: 1_800 }), segment: {} });

        const answer = await source.segmentFor(SUBJECT, new Set());

        expect(answer).toEqual({ segmentId: 'seg-1', durationMs: (1_800 / WORDS_PER_MINUTE) * 60_000 });
    });

    it('declines a band that names no series at all', async () => {
        // Unlike a syndicated band, which with no topic carries the newest episode of any show.
        const { source } = build({ next: piece({ segmentId: 'seg-1' }) });

        expect(await source.segmentFor(undefined, new Set())).toEqual({ declined: expect.stringContaining('names no series') });
    });

    it('declines when the topic points at nothing', async () => {
        const { source } = build({ topics: [{ id: 't1', kind: 'narration', config: {} }] });

        expect(await source.segmentFor(SUBJECT, new Set())).toEqual({ declined: expect.stringContaining('names no series') });
    });

    it('declines when the series has nothing left to read', async () => {
        const { source } = build({ next: undefined });

        expect(await source.segmentFor(SUBJECT, new Set())).toEqual({ declined: expect.stringContaining('nothing left to read') });
    });

    it('declines a piece that has not been spoken yet', async () => {
        const { source } = build({ next: piece() });

        expect(await source.segmentFor(SUBJECT, new Set())).toEqual({ declined: expect.stringContaining('has not been spoken') });
    });

    it('declines with the reason when the piece could not be spoken', async () => {
        // An operator reading the console should be told why the slot went quiet.
        const { source } = build({ next: piece({ renderError: 'the station has no mixer' }) });

        expect(await source.segmentFor(SUBJECT, new Set())).toEqual({ declined: expect.stringContaining('no mixer') });
    });

    it('declines a piece the running order already holds', async () => {
        // A band that comes round again before the last one aired must not plant it twice.
        const { source } = build({ next: piece({ segmentId: 'seg-1' }), segment: { durationMs: 1_000 } });

        expect(await source.segmentFor(SUBJECT, new Set(['seg-1']))).toEqual({ declined: expect.stringContaining('already in the running order') });
    });
});
