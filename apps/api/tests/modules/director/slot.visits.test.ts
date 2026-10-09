// A guest host who comes "about one night in seven" has to feel unscheduled and still be the same
// answer every time anybody asks about a night, because the tick asks every minute and a host who
// flipped mid-show would be a changeover nobody chose. So the properties pinned here are: the same
// night always answers the same, the rate over a long run is near the odds, nothing lands inside the
// cooldown, and a fixed night beats a random one.

import { describe, expect, it } from 'vitest';

import { addDays, type ScheduleSlot, type SlotPerson, type StationDate } from '../../../src/modules/director/schedule.js';
import { appears, coHostsFor, defaultCooldown, hostFor, roll } from '../../../src/modules/director/slot.visits.js';

const boneyard = (guestHosts: SlotPerson[] = []): ScheduleSlot => ({
    id: 'fa835126-8b56-4a03-b811-916a97c8c54b',
    label: 'The Boneyard',
    startsAtMinutes: 990,
    endsAtMinutes: 0,
    days: [],
    personaId: 'ozzy',
    guestHosts,
    mode: 'rotation',
    onEnd: 'extend',
});

/** Thursday 1 January 2026. */
const START: StationDate = { year: 2026, month: 1, day: 1, weekday: 4 };

/** Every date in a run of days, from START. */
const days = (count: number): StationDate[] => Array.from({ length: count }, (_, index) => addDays(START, index));

describe('roll', () => {
    it('is the same for the same key and lands in [0, 1)', () => {
        expect(roll('a|b|2026-10-31')).toBe(roll('a|b|2026-10-31'));
        for (const date of days(200)) {
            const value = roll(`slot|person|${date.year}-${date.month}-${date.day}`);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });
});

describe('appears', () => {
    it('answers the same for the same night however often it is asked', () => {
        const rockzo: SlotPerson = { personaId: 'rockzo', everyN: 7 };
        const slot = boneyard([rockzo]);

        for (const date of days(60)) expect(appears(rockzo, slot, date)).toBe(appears(rockzo, slot, date));
    });

    it.each([7, 14, 25])('comes about one night in %i over two years', everyN => {
        const visitor: SlotPerson = { personaId: `visitor-${everyN}`, everyN };
        const slot = boneyard([visitor]);
        const nights = days(730).filter(date => appears(visitor, slot, date)).length;

        // The nightly chance pays for the cooldown, so the AVERAGE gap is still about `everyN`. The
        // bounds are wide enough for a hash and narrow enough to catch odds not being applied.
        expect(nights).toBeGreaterThan((730 / everyN) * 0.7);
        expect(nights).toBeLessThan((730 / everyN) * 1.3);
    });

    it('comes about once in twenty-five nights with a fortnight’s cooldown, never inside it', () => {
        const visitor: SlotPerson = { personaId: 'lemmy', everyN: 25, cooldownDays: 14 };
        const slot = boneyard([visitor]);
        const nights = days(730).filter(date => appears(visitor, slot, date));

        expect(nights.length).toBeGreaterThan((730 / 25) * 0.7);
        expect(nights.length).toBeLessThan((730 / 25) * 1.3);
        for (let index = 1; index < nights.length; index++) {
            const gap =
                (Date.UTC(nights[index]!.year, nights[index]!.month - 1, nights[index]!.day) -
                    Date.UTC(nights[index - 1]!.year, nights[index - 1]!.month - 1, nights[index - 1]!.day)) /
                86_400_000;
            expect(gap).toBeGreaterThan(14);
        }
    });

    it('keeps an about-weekly guest off consecutive nights by default', () => {
        expect(defaultCooldown(7)).toBe(3);

        const rockzo: SlotPerson = { personaId: 'rockzo', everyN: 7 };
        const slot = boneyard([rockzo]);
        const won = days(730).map(date => appears(rockzo, slot, date));

        for (let index = 1; index < won.length; index++) expect(won[index] && won[index - 1]).toBe(false);
    });

    it('reads fixed nights against the weekday the night began on', () => {
        const fridays: SlotPerson = { personaId: 'rockzo', days: [5] };

        expect(appears(fridays, boneyard([fridays]), { year: 2026, month: 10, day: 9, weekday: 5 })).toBe(true);
        expect(appears(fridays, boneyard([fridays]), { year: 2026, month: 10, day: 10, weekday: 6 })).toBe(false);
    });

    it('is on every night with neither days nor odds, which is a co-host', () => {
        expect(appears({ personaId: 'cohost' }, boneyard(), START)).toBe(true);
    });
});

describe('hostFor', () => {
    it('is the slot’s own host on an ordinary night', () => {
        expect(hostFor(boneyard(), START)).toEqual({ personaId: 'ozzy', guest: false });
    });

    it('puts a guest on their fixed night and says whose show it is', () => {
        const fridays: SlotPerson = { personaId: 'rockzo', days: [5] };

        expect(hostFor(boneyard([fridays]), { year: 2026, month: 10, day: 9, weekday: 5 })).toEqual({
            personaId: 'rockzo',
            regularPersonaId: 'ozzy',
            guest: true,
        });
    });

    it('lets a fixed night win over a random guest who also won it', () => {
        const always: SlotPerson = { personaId: 'random', everyN: 2, cooldownDays: 0 };
        const fixed: SlotPerson = { personaId: 'rockzo', days: [0, 1, 2, 3, 4, 5, 6] };
        const slot = boneyard([always, fixed]);

        for (const date of days(30)) expect(hostFor(slot, date).personaId).toBe('rockzo');
    });

    it('names no regular host for a slot the station’s own host presents', () => {
        const fridays: SlotPerson = { personaId: 'rockzo', days: [5] };

        const { personaId: _host, ...hostless } = boneyard([fridays]);

        expect(hostFor(hostless, { year: 2026, month: 10, day: 9, weekday: 5 })).toEqual({ personaId: 'rockzo', guest: true });
    });
});

describe('coHostsFor', () => {
    const withCoHosts = (coHosts: SlotPerson[]): ScheduleSlot => ({ ...boneyard(), coHosts });
    const FRIDAY: StationDate = { year: 2026, month: 10, day: 9, weekday: 5 };

    it('puts every-night co-hosts on every night, in the order they were written', () => {
        expect(coHostsFor(withCoHosts([{ personaId: 'b' }, { personaId: 'a' }]), START, 'ozzy')).toEqual(['b', 'a']);
    });

    it('puts a fixed co-host on their nights only', () => {
        const slot = withCoHosts([{ personaId: 'friday', days: [5] }]);

        expect(coHostsFor(slot, FRIDAY, 'ozzy')).toEqual(['friday']);
        expect(coHostsFor(slot, START, 'ozzy')).toEqual([]);
    });

    it('brings a visitor on the nights their roll wins, about once in everyN over two years', () => {
        const lemmy: SlotPerson = { personaId: 'lemmy', everyN: 25, cooldownDays: 14 };
        const slot = withCoHosts([lemmy]);
        const nights = days(730).filter(date => coHostsFor(slot, date, 'ozzy').includes('lemmy')).length;

        expect(nights).toBeGreaterThan((730 / 25) * 0.7);
        expect(nights).toBeLessThan((730 / 25) * 1.3);
    });

    it('never puts the night’s presenter beside themselves', () => {
        expect(coHostsFor(withCoHosts([{ personaId: 'ozzy' }, { personaId: 'a' }]), START, 'ozzy')).toEqual(['a']);
    });

    it('stops at three, so a visitor who wins a full night sits it out', () => {
        const slot = withCoHosts([{ personaId: 'a' }, { personaId: 'b' }, { personaId: 'c' }, { personaId: 'visitor', everyN: 2, cooldownDays: 0 }]);

        for (const date of days(20)) expect(coHostsFor(slot, date, 'ozzy')).toEqual(['a', 'b', 'c']);
    });
});
