// Rolling back is the thing that makes a character safe to leave growing on its own, so what is
// pinned here is mostly what it must NOT do: touch anything an operator wrote, convert the moment it
// was given, or move the distil watermark unless it was asked to.
//
// The precision rule is the one worth stating twice. Every timestamp through this service is the
// column's own text, because Luxon is millisecond-resolution and Postgres is microsecond — a moment
// taken off a row, round-tripped through a `DateTime` and handed back compares as EARLIER than the
// row it came from, which would delete the row an operator clicked "roll back to here" on.

import { describe, expect, it, vi } from 'vitest';

import { PersonaMemoryService } from '../../../src/modules/personas/persona.memory.service.js';

/** The microsecond tail is the point: nothing here may round it off. */
const MOMENT = '2026-05-12 14:30:00.123456+00';

function build(options: { persona?: { key: string } } = {}) {
    const personas = { find: vi.fn(async () => ('persona' in options ? options.persona : { key: 'latenight' })) };
    const tellings = {
        countAfter: vi.fn(async () => 3),
        removeAfter: vi.fn(async () => 3),
        timeline: vi.fn(async () => []),
    };
    const notes = {
        countAfter: vi.fn(async () => ({ notes: 2, rejected: 1, touched: 0 })),
        rollbackAfter: vi.fn(async () => 2),
        pullReadThrough: vi.fn(async () => {}),
    };
    const stories = {
        countAfter: vi.fn(async () => ({ stories: 1, details: 4, rejected: 0, touched: 2 })),
        rollbackAfter: vi.fn(async () => ({ stories: 1, details: 4 })),
    };
    const activity = { record: vi.fn(async () => undefined) };

    const service = new PersonaMemoryService(personas as never, notes as never, stories as never, tellings as never, activity as never);

    return { service, personas, tellings, notes, stories, activity };
}

describe('previewing a rollback', () => {
    it('counts every store, and sums the two judgements across them', async () => {
        const { service } = build();

        const change = await service.preview('p1', { to: MOMENT });

        expect(change).toEqual({ tellings: 3, notes: 2, stories: 1, details: 4, rejected: 1, touched: 2 });
    });

    it('hands the moment down exactly as it was given', async () => {
        const { service, tellings, notes, stories } = build();

        await service.preview('p1', { to: MOMENT });

        // Not an ISO re-rendering of it, and not a DateTime. See the file note.
        expect(tellings.countAfter).toHaveBeenCalledWith('latenight', MOMENT);
        expect(notes.countAfter).toHaveBeenCalledWith('latenight', MOMENT);
        expect(stories.countAfter).toHaveBeenCalledWith('latenight', MOMENT);
    });

    it('counts all of it when no moment is given, which is what a reset would take', async () => {
        const { service, tellings } = build();

        await service.preview('p1', {});

        expect(tellings.countAfter).toHaveBeenCalledWith('latenight', '-infinity');
    });

    it('changes nothing', async () => {
        const { service, tellings, notes, stories } = build();

        await service.preview('p1', { to: MOMENT });

        expect(tellings.removeAfter).not.toHaveBeenCalled();
        expect(notes.rollbackAfter).not.toHaveBeenCalled();
        expect(stories.rollbackAfter).not.toHaveBeenCalled();
    });

    it('refuses a moment it cannot read rather than letting the database fail', async () => {
        const { service } = build();

        // A 400 with a sentence, rather than `::timestamptz` throwing as a 500.
        await expect(service.preview('p1', { to: 'last Tuesday' })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('answers 404 for a persona that does not exist', async () => {
        const { service } = build({ persona: undefined });

        await expect(service.preview('nobody', { to: MOMENT })).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('rolling back', () => {
    it('cuts all three stores', async () => {
        const { service, tellings, notes, stories } = build();

        await service.rollback('p1', { to: MOMENT });

        expect(tellings.removeAfter).toHaveBeenCalledWith('latenight', MOMENT);
        expect(notes.rollbackAfter).toHaveBeenCalledWith('latenight', MOMENT);
        expect(stories.rollbackAfter).toHaveBeenCalledWith('latenight', MOMENT);
        // And nothing else needs putting back in step, which is most of why the ledger is worth
        // having: the rotation and the telling count are READ off it rather than stored beside it,
        // so cutting it down is the whole of undoing them.
    });

    it('reports what it undid, counted before it undid it', async () => {
        const { service } = build();

        const result = await service.rollback('p1', { to: MOMENT });

        // Counted afterwards this is all zeroes, which is the bug this ordering exists to avoid.
        expect(result.undone).toEqual({ tellings: 3, notes: 2, stories: 1, details: 4, rejected: 1, touched: 2 });
    });

    it('leaves the distil watermark alone unless asked', async () => {
        const { service, notes } = build();

        await service.rollback('p1', { to: MOMENT });

        // Re-reading the window is right for testing and wrong for undoing a character that
        // drifted: the second wants the conclusions gone, and moving the watermark back invites the
        // same pass to reach them again tonight.
        expect(notes.pullReadThrough).not.toHaveBeenCalled();
    });

    it('drags it back when it is', async () => {
        const { service, notes } = build();

        await service.rollback('p1', { to: MOMENT, relearn: true });

        expect(notes.pullReadThrough).toHaveBeenCalledWith('latenight', MOMENT);
    });

    it('takes everything when no moment is given', async () => {
        const { service, tellings, notes, stories } = build();

        await service.rollback('p1', {});

        expect(tellings.removeAfter).toHaveBeenCalledWith('latenight', '-infinity');
        expect(notes.rollbackAfter).toHaveBeenCalledWith('latenight', '-infinity');
        expect(stories.rollbackAfter).toHaveBeenCalledWith('latenight', '-infinity');
    });

    it('records one row in the feed, naming what was spared', async () => {
        const { service, activity } = build();

        await service.rollback('p1', { to: MOMENT });

        expect(activity.record).toHaveBeenCalledWith(
            expect.objectContaining({
                module: 'director',
                kind: 'persona.memoryRolledBack',
                detail: expect.stringContaining('written by hand is untouched'),
            }),
        );
    });

    it('answers the timeline as it stands afterwards', async () => {
        const { service, tellings } = build();

        const result = await service.rollback('p1', { to: MOMENT });

        // Read after the deletes, so the console draws what is actually left.
        expect(result.tellings).toEqual([]);
        expect(tellings.timeline).toHaveBeenCalled();
    });

    it('refuses a moment it cannot read before deleting anything', async () => {
        const { service, tellings } = build();

        await expect(service.rollback('p1', { to: 'yesterday-ish' })).rejects.toMatchObject({ statusCode: 400 });
        expect(tellings.removeAfter).not.toHaveBeenCalled();
    });
});
