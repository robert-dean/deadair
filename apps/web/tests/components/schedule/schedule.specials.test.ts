// Where a special stands is a question about the STATION's calendar, so every case hands over the
// station's today as a string. The yearly cases are the ones worth having: a range across New Year,
// and the 29th of February, which the station's resolver airs only in a leap year.

import { describe, expect, it } from 'vitest';
import type { ScheduleSlot } from '@deadair/sdk';

import { formatDates, inOrder, isSpecial, nextRun, stateOf, type Special } from '../../../src/components/schedule/schedule.specials';

const special = (id: string, startsOn: string, endsOn: string, yearly = false): Special => ({
    id,
    label: id,
    startsAtMinutes: 20 * 60,
    endsAtMinutes: 23 * 60,
    days: [],
    startsOn,
    endsOn,
    yearly,
    mode: 'rotation',
    onEnd: 'extend',
});

describe('isSpecial', () => {
    it('is a slot with both dates', () => {
        const weekly: ScheduleSlot = { id: 'w', label: 'w', startsAtMinutes: 0, endsAtMinutes: 60, days: [], mode: 'rotation', onEnd: 'extend' };

        expect(isSpecial(weekly)).toBe(false);
        expect(isSpecial(special('h', '2026-10-31', '2026-10-31'))).toBe(true);
    });
});

describe('nextRun', () => {
    it('is the one-off itself until it has ended, and nothing after', () => {
        const gig = special('gig', '2026-10-31', '2026-11-01');

        expect(nextRun(gig, '2026-10-09')).toEqual({ from: '2026-10-31', to: '2026-11-01' });
        expect(nextRun(gig, '2026-11-01')).toEqual({ from: '2026-10-31', to: '2026-11-01' });
        expect(nextRun(gig, '2026-11-02')).toBeUndefined();
    });

    it("moves a yearly special to this year's dates, or next year's once this year's are over", () => {
        const halloween = special('halloween', '2020-10-31', '2020-10-31', true);

        expect(nextRun(halloween, '2026-10-09')).toEqual({ from: '2026-10-31', to: '2026-10-31' });
        expect(nextRun(halloween, '2026-11-01')).toEqual({ from: '2027-10-31', to: '2027-10-31' });
    });

    it('keeps a yearly range across New Year whole', () => {
        const turn = special('turn', '2025-12-30', '2026-01-02', true);

        expect(nextRun(turn, '2026-12-01')).toEqual({ from: '2026-12-30', to: '2027-01-02' });
        // On the 1st of January the run that began last December is still on.
        expect(nextRun(turn, '2027-01-01')).toEqual({ from: '2026-12-30', to: '2027-01-02' });
    });

    it('runs a 29th of February special only in a leap year', () => {
        expect(nextRun(special('leap', '2024-02-29', '2024-02-29', true), '2026-10-09')).toEqual({ from: '2028-02-29', to: '2028-02-29' });
    });
});

describe('stateOf', () => {
    it('says now, coming up or over', () => {
        const gig = special('gig', '2026-10-31', '2026-11-01');

        expect(stateOf(gig, '2026-10-30')).toBe('upcoming');
        expect(stateOf(gig, '2026-10-31')).toBe('now');
        expect(stateOf(gig, '2026-11-02')).toBe('over');
        expect(stateOf(special('h', '2020-10-31', '2020-10-31', true), '2026-11-02')).toBe('upcoming');
    });
});

describe('inOrder', () => {
    it('puts what is on today first, then the soonest, then the one-offs that are over, latest first', () => {
        const ordered = inOrder(
            [
                special('old', '2025-12-24', '2025-12-25'),
                special('christmas', '2020-12-24', '2020-12-26', true),
                special('today', '2026-10-09', '2026-10-09'),
                special('halloween', '2020-10-31', '2020-10-31', true),
                special('older', '2024-06-01', '2024-06-01'),
            ],
            '2026-10-09',
        );

        expect(ordered.map(item => item.id)).toEqual(['today', 'halloween', 'christmas', 'old', 'older']);
    });
});

describe('formatDates', () => {
    it('writes one day, a range, and the year only when asked for', () => {
        expect(formatDates('2026-10-31', '2026-10-31', false)).toMatch(/31/);
        expect(formatDates('2026-10-31', '2026-10-31', true)).toMatch(/2026/);
        expect(formatDates('2026-12-24', '2026-12-26', false)).not.toMatch(/2026/);
    });
});
