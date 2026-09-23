// Two jobs in one pass: asking for what the clock will want, and collecting what has been spoken.
// The second is the one with no other home: a production is finished by the director noticing its
// beats are ready, and nothing in that path knows what a narration piece is.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { MAX_AUTOMATIC_RENDER_ATTEMPTS, NarrationScheduler, RENDER_AHEAD_MS } from '../../../src/modules/narrations/narration.scheduler.js';
import type { NarrationPieceRecord } from '../../../src/modules/narrations/narration.piece.js';

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

const NOW = Date.parse('2026-09-16T12:00:00.000Z');

const piece = (over: Partial<NarrationPieceRecord> = {}): NarrationPieceRecord => ({
    id: 'piece-1',
    seriesId: 'deadair.audiobook:frankenstein',
    pieceId: 'ch4',
    seriesTitle: 'Frankenstein',
    title: 'Chapter 4',
    seriesOrder: 'serial',
    renderAttempts: 0,
    seenAt: NOW,
    ...over,
});

interface Options {
    /** How far from now the band's next occurrence is. */
    inMs?: number;
    found?: NarrationPieceRecord | { declined: string };
    claimed?: boolean;
    production?: { id: string; state: string; error?: string } | undefined;
    joined?: { id: string; durationMs?: number };
    bandKind?: string;
    /** What the collection sweep finds: every piece a production is being made for. */
    awaiting?: NarrationPieceRecord[];
}

function build(options: Options = {}) {
    const bands = {
        active: vi.fn(async () => [
            { at: 'clock', minute: 0, hour: 22, kind: options.bandKind ?? 'narration', topic: { id: 't1', key: 'f', label: 'Frankenstein' } },
        ]),
    };

    const found = options.found ?? piece();
    const source = {
        pieceFor: vi.fn(async () => ('declined' in found ? found : { piece: found })),
    };

    const pieces = {
        claimRender: vi.fn(async () => options.claimed ?? true),
        awaitingCollection: vi.fn(async () => options.awaiting ?? []),
        markRendered: vi.fn(async () => {}),
        markRenderFailed: vi.fn(async () => {}),
    };

    const productions = {
        findById: vi.fn(async () => options.production),
        moveTo: vi.fn(async () => true),
        fail: vi.fn(async () => true),
    };

    const segments = { joinedOf: vi.fn(async () => options.joined) };
    const jobs = { send: vi.fn(async () => {}) };
    const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;

    // The band is at 22:00; `nextOccurrence` works it out from the clock, so the test moves NOW
    // rather than the band to put the slot inside or outside the window.
    const scheduler = new NarrationScheduler(
        bands as never,
        source as never,
        pieces as never,
        productions as never,
        segments as never,
        jobs as never,
        config,
        logger as never,
    );
    return { scheduler, pieces, productions, segments, jobs };
}

describe('NarrationScheduler asking for what the clock will want', () => {
    it('asks for a piece whose slot is inside the window', async () => {
        const { scheduler, jobs } = build();

        // 22:00 is ten hours off at noon, so wind the clock to inside the six-hour window.
        const asked = await scheduler.ripen(Date.parse('2026-09-16T20:00:00.000Z'));

        expect(asked).toBe(1);
        expect(jobs.send).toHaveBeenCalledWith('narrations.render', { pieceId: 'piece-1' });
    });

    it('leaves a slot that is still far off alone', async () => {
        const { scheduler, jobs } = build();

        // Noon against a 22:00 band is ten hours, well past the window.
        expect(await scheduler.ripen(NOW)).toBe(0);
        expect(jobs.send).not.toHaveBeenCalled();
        expect(RENDER_AHEAD_MS).toBeLessThan(10 * 60 * 60_000);
    });

    it('ignores a band of any other kind', async () => {
        const { scheduler, jobs } = build({ bandKind: 'syndicated' });

        await scheduler.ripen(Date.parse('2026-09-16T20:00:00.000Z'));

        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('says nothing when the series has nothing left to read', async () => {
        const { scheduler, jobs } = build({ found: { declined: 'nothing left' } });

        expect(await scheduler.ripen(Date.parse('2026-09-16T20:00:00.000Z'))).toBe(0);
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('does not ask again for a piece it already holds', async () => {
        const { scheduler, jobs } = build({ found: piece({ segmentId: 'seg-1' }) });

        await scheduler.ripen(Date.parse('2026-09-16T20:00:00.000Z'));

        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('stops asking after too many failures, leaving an operator to ask', async () => {
        const { scheduler, jobs } = build({ found: piece({ renderAttempts: MAX_AUTOMATIC_RENDER_ATTEMPTS }) });

        await scheduler.ripen(Date.parse('2026-09-16T20:00:00.000Z'));

        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('sends nothing when the claim was lost to another pass', async () => {
        const { scheduler, jobs } = build({ claimed: false });

        expect(await scheduler.ripen(Date.parse('2026-09-16T20:00:00.000Z'))).toBe(0);
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('swallows a failure rather than taking the commit pass down with it', async () => {
        const { scheduler } = build();
        (scheduler as unknown as { bands: { active: () => Promise<never> } }).bands.active = async () => {
            throw new Error('the database is gone');
        };

        expect(await scheduler.ripen(NOW)).toBe(0);
    });
});

describe('NarrationScheduler collecting what has been spoken', () => {
    const inWindow = Date.parse('2026-09-16T20:00:00.000Z');
    const waiting = piece({ productionId: 'prod-1' });

    it('hands a finished reading to the piece that asked for it', async () => {
        const { scheduler, pieces, productions } = build({
            found: waiting,
            awaiting: [waiting],
            production: { id: 'prod-1', state: 'ready' },
            joined: { id: 'joined-1', durationMs: 612_000 },
        });

        await scheduler.ripen(inWindow);

        expect(pieces.markRendered).toHaveBeenCalledWith('piece-1', 'joined-1');
        // And out of `unfinished`, which is capped at twenty and ordered oldest first: readings
        // parked in it would eventually crowd out every phone-in waiting to be placed.
        expect(productions.moveTo).toHaveBeenCalledWith('prod-1', 'aired', 'ready');
    });

    it('fails the piece when nothing joined the parts, rather than airing them separately', async () => {
        // A block of beats cannot ride a single-segment answer, so unlike a phone-in this cannot air
        // as its parts. A station with no mixer gets a reason on the row instead.
        const { scheduler, pieces, productions } = build({
            found: waiting,
            awaiting: [waiting],
            production: { id: 'prod-1', state: 'ready' },
            joined: undefined,
        });

        await scheduler.ripen(inWindow);

        expect(pieces.markRenderFailed).toHaveBeenCalledWith('piece-1', expect.stringContaining('no mixer'));
        expect(productions.fail).toHaveBeenCalled();
        expect(pieces.markRendered).not.toHaveBeenCalled();
    });

    it('writes down a production that failed, so the piece can be tried again', async () => {
        const { scheduler, pieces } = build({
            found: waiting,
            awaiting: [waiting],
            production: { id: 'prod-1', state: 'failed', error: 'a beat could not be spoken' },
        });

        await scheduler.ripen(inWindow);

        expect(pieces.markRenderFailed).toHaveBeenCalledWith('piece-1', 'a beat could not be spoken');
    });

    it('writes down a production an operator cancelled', async () => {
        const { scheduler, pieces } = build({ found: waiting, awaiting: [waiting], production: { id: 'prod-1', state: 'cancelled' } });

        await scheduler.ripen(inWindow);

        expect(pieces.markRenderFailed).toHaveBeenCalledWith('piece-1', expect.stringContaining('cancelled'));
    });

    it('writes down a production that has been deleted out from under the piece', async () => {
        // Otherwise the piece waits forever on a row that no longer exists.
        const { scheduler, pieces } = build({ found: waiting, awaiting: [waiting], production: undefined });

        await scheduler.ripen(inWindow);

        expect(pieces.markRenderFailed).toHaveBeenCalledWith('piece-1', expect.stringContaining('gone'));
    });

    it('leaves a production that is still being spoken alone', async () => {
        // The ordinary state on most passes.
        const { scheduler, pieces, productions } = build({ found: waiting, awaiting: [waiting], production: { id: 'prod-1', state: 'rendering' } });

        await scheduler.ripen(inWindow);

        expect(pieces.markRendered).not.toHaveBeenCalled();
        expect(pieces.markRenderFailed).not.toHaveBeenCalled();
        expect(productions.fail).not.toHaveBeenCalled();
    });

    it('never asks for a second render while one is in flight', async () => {
        const { scheduler, jobs } = build({ found: waiting, awaiting: [waiting], production: { id: 'prod-1', state: 'rendering' } });

        await scheduler.ripen(inWindow);

        expect(jobs.send).not.toHaveBeenCalled();
    });

    // The piece a production was made for is not always the one a band wants next: a `latest` issue
    // overtaken while it was being spoken, a piece its plugin withdrew mid-render. Collecting only
    // what `nextFor` answered left those productions out of `aired`, crowding the phone-ins.
    it('collects a finished reading no band will ask about again', async () => {
        const overtaken = piece({ id: 'piece-0', productionId: 'prod-0' });
        const { scheduler, pieces, productions } = build({
            found: piece({ id: 'piece-2', pieceId: 'ch6' }),
            awaiting: [overtaken],
            production: { id: 'prod-0', state: 'ready' },
            joined: { id: 'joined-0', durationMs: 540_000 },
        });

        await scheduler.ripen(inWindow);

        expect(pieces.markRendered).toHaveBeenCalledWith('piece-0', 'joined-0');
        expect(productions.moveTo).toHaveBeenCalledWith('prod-0', 'aired', 'ready');
    });

    it('collects a withdrawn piece, which keeps its audio and is kept off air by nextFor', async () => {
        const withdrawn = piece({ productionId: 'prod-1', withdrawnAt: NOW });
        const { scheduler, pieces } = build({
            found: { declined: 'nothing left' },
            awaiting: [withdrawn],
            production: { id: 'prod-1', state: 'ready' },
            joined: { id: 'joined-1' },
        });

        await scheduler.ripen(inWindow);

        expect(pieces.markRendered).toHaveBeenCalledWith('piece-1', 'joined-1');
    });

    it('collects even when no band wants a reading', async () => {
        // A band removed mid-render still leaves a production somebody has to move on.
        const { scheduler, pieces } = build({
            bandKind: 'syndicated',
            awaiting: [waiting],
            production: { id: 'prod-1', state: 'ready' },
            joined: { id: 'joined-1' },
        });

        await scheduler.ripen(NOW);

        expect(pieces.markRendered).toHaveBeenCalledWith('piece-1', 'joined-1');
    });
});
