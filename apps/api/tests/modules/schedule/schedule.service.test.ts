// `current` carries two distinctions that look like one fact each. The first is what the clock says
// should be on against what the station is actually airing: they differ for exactly as long as an
// operator's own choice is holding, and a console that collapsed them would be confidently wrong for
// precisely that stretch. The second is the block on now against the blocks after it — the same
// projection the timetable draws, answered here so a page can lead with what is on rather than
// deriving station-local dates in a browser that does not know the station's timezone.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { ScheduleService } from '../../../src/modules/schedule/schedule.service.js';
import type { ScheduleRepository } from '../../../src/modules/schedule/schedule.repository.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const slot = (id: string, startsAtMinutes: number, endsAtMinutes: number, days: readonly number[] = []): ScheduleSlot => ({
    id,
    label: id,
    startsAtMinutes,
    endsAtMinutes,
    days,
    mode: 'rotation',
    onEnd: 'extend',
});

function build(options: { slots?: ScheduleSlot[]; airing?: string } = {}) {
    const slots = { list: vi.fn(async () => options.slots ?? []) } as unknown as ScheduleRepository;
    const director = {
        status: vi.fn(() => ({
            active: true,
            airMode: 'audience' as const,
            remaining: 0,
            ...(options.airing === undefined ? {} : { slotId: options.airing }),
        })),
    } as unknown as DirectorService;

    // A real string, not a boolean: every layer of AppConfig holds strings, and a double that hands
    // back something else proves nothing about what the app will read.
    const config = { get: vi.fn(() => 'Europe/London'), has: vi.fn(() => true) } as unknown as AppConfig;

    return new ScheduleService(slots, director, config, logger);
}

describe('ScheduleService.current', () => {
    // Wednesday 19 August 2026, 13:00 in Europe/London (BST, so an hour ahead of the instant). Fixed
    // because every assertion below is about which blocks are still to come, which is a question
    // about a particular afternoon.
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-19T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('answers with the clock and nothing else for a station with no schedule', async () => {
        // `now` is unconditional: it is what makes "an hour left" a subtraction rather than a guess,
        // and a station with no schedule still has a clock.
        expect(await build().current()).toEqual({ now: '2026-08-19 13:00:00', upcoming: [] });
    });

    it('reports the same slot twice when the station is airing what is due', async () => {
        // Midnight and midday both exist, so whichever the clock is in, the station is on it.
        const service = build({ slots: [slot('all-day', 0, 0)], airing: 'all-day' });

        expect(await service.current()).toMatchObject({ slotId: 'all-day', airingSlotId: 'all-day' });
    });

    it('reports both when an operator has taken the station over', async () => {
        // The state the manual-takeover rule creates: the clock wants one slot and the running order
        // belongs to another, and it stays that way until the next slot BEGINS. Both have to come
        // back or the console cannot draw the difference.
        const service = build({ slots: [slot('daytime', 0, 0)], airing: 'evening' });

        expect(await service.current()).toMatchObject({ slotId: 'daytime', airingSlotId: 'evening' });
    });

    it('leaves the airing slot out for a station that belongs to no slot', async () => {
        // The commonest form of a takeover, and the one worth pinning: a station put on by hand
        // before there was a schedule at all has no slot on its running order. That is an absent
        // field rather than a match, so the console still knows the two disagree.
        const service = build({ slots: [slot('daytime', 0, 0)] });

        expect(await service.current()).not.toHaveProperty('airingSlotId');
    });

    it('leads with the block it is part-way through, and cuts an overnight one at midnight', async () => {
        // A block is over when it ENDS, so the one on now is the first thing coming rather than
        // something already past — which is the whole point of the strip this feeds. The block behind
        // it runs to six in the morning and arrives as two, exactly as the timetable draws it.
        const service = build({ slots: [slot('daytime', 6 * 60, 18 * 60), slot('evening', 18 * 60, 6 * 60)] });

        const { upcoming } = await service.current();

        expect(upcoming.slice(0, 3)).toEqual([
            { slotId: 'daytime', label: 'daytime', start: '2026-08-19 06:00:00', end: '2026-08-19 18:00:00' },
            { slotId: 'evening', label: 'evening', start: '2026-08-19 18:00:00', end: '2026-08-20 00:00:00' },
            { slotId: 'evening', label: 'evening', start: '2026-08-20 00:00:00', end: '2026-08-20 06:00:00' },
        ]);
    });

    it('leaves a gap absent rather than filling it', async () => {
        // Nothing is on at one in the afternoon and the next block starts at six. The answer is the
        // six o'clock block with no slot in force — what plays in between is the sustaining source,
        // which is a different question and not this one's to answer.
        const service = build({ slots: [slot('evening', 18 * 60, 20 * 60)] });

        const answer = await service.current();

        expect(answer.slotId).toBeUndefined();
        expect(answer.upcoming[0]).toMatchObject({ slotId: 'evening', start: '2026-08-19 18:00:00' });
    });

    it('looks far enough ahead to find a block that runs one day a week', async () => {
        // The reason the look-ahead is a week and not a day or two: a station whose only block is on
        // Sundays would otherwise be told nothing is scheduled, which is the opposite of true.
        const service = build({ slots: [slot('sundays', 10 * 60, 12 * 60, [0])] });

        const { upcoming } = await service.current();

        expect(upcoming).toEqual([{ slotId: 'sundays', label: 'sundays', start: '2026-08-23 10:00:00', end: '2026-08-23 12:00:00' }]);
    });

    it('answers three blocks and no more', async () => {
        // Enough for "on now, up next, after that". A fourth is a timetable, and the page asking this
        // is already drawing one.
        const service = build({ slots: [slot('all-day', 0, 0)] });

        expect((await service.current()).upcoming).toHaveLength(3);
    });
});

describe('ScheduleService.timetable', () => {
    it("anchors on the station's own today and echoes the range it drew", async () => {
        // The reason `from` is optional at all: a browser cannot work out what day it is at the
        // station, so an absent one has to mean "you tell me" and the answer has to say what it
        // chose. Everything after that is a caller adding days to a string.
        const service = build({ slots: [slot('all-day', 0, 0)] });

        const drawn = await service.timetable({});

        expect(drawn.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(drawn.days).toBe(7);
        expect(drawn.occurrences).toHaveLength(7);
    });

    it('derives the weekday from the date rather than trusting the caller', async () => {
        // 2026-08-19 is a Wednesday. A slot that runs only on Wednesdays must therefore be drawn on
        // the first day and on nothing else in the week. This is the one field a client could get
        // wrong in a way that silently draws a different schedule than the station will air.
        const service = build({ slots: [slot('midweek', 0, 0, [3])] });

        const drawn = await service.timetable({ from: '2026-08-19', days: 3 });

        // Wednesday alone, out of three days asked for. Nothing stretches to cover Thursday and
        // Friday any more, so this genuinely tests the weekday rather than passing because every day
        // was covered regardless.
        expect(drawn.occurrences.map(block => block.start.slice(0, 10))).toEqual(['2026-08-19']);
    });

    it('falls back to today for a date it cannot read, rather than erroring', async () => {
        // A hand-typed URL should not produce a blank page, and there is nothing here worth a 400:
        // the worst outcome of falling back is that the operator is looking at this week.
        const service = build({ slots: [slot('all-day', 0, 0)] });

        const drawn = await service.timetable({ from: 'yesterday' });

        expect(drawn.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(drawn.occurrences.length).toBeGreaterThan(0);
    });
});
