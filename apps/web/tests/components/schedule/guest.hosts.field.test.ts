// The rows hold both halves of WHEN while they are open; what goes to the API says WHEN in exactly
// one way, which is the rule the API refuses anything else by.

import { describe, expect, it } from 'vitest';

import { guestHostsOf, guestRowOf, guestRowProblem, type GuestRow } from '../../../src/components/schedule/guest.hosts.field';

const row = (over: Partial<GuestRow> = {}): GuestRow => ({ personaId: 'rockzo', when: 'random', days: [], everyN: 7, cooldownDays: '', ...over });

describe('guestHostsOf', () => {
    it('sends a random guest with their odds, and a cooldown only when one was typed', () => {
        expect(guestHostsOf([row()])).toEqual([{ personaId: 'rockzo', everyN: 7 }]);
        expect(guestHostsOf([row({ everyN: 25, cooldownDays: 14 })])).toEqual([{ personaId: 'rockzo', everyN: 25, cooldownDays: 14 }]);
    });

    it('sends a fixed guest with their nights and no odds, whatever the other half still holds', () => {
        expect(guestHostsOf([row({ when: 'days', days: ['5', '3'], everyN: 9 })])).toEqual([{ personaId: 'rockzo', days: [5, 3] }]);
    });

    it('sends an every-night co-host with neither nights nor odds', () => {
        expect(guestHostsOf([row({ when: 'always', days: ['5'] })])).toEqual([{ personaId: 'rockzo' }]);
    });

    it('drops a row with nobody chosen', () => {
        expect(guestHostsOf([row({ personaId: '' })])).toEqual([]);
    });

    it('reads a stored guest back into a row', () => {
        expect(guestRowOf({ personaId: 'lemmy', everyN: 25, cooldownDays: 14 })).toEqual(row({ personaId: 'lemmy', everyN: 25, cooldownDays: 14 }));
        expect(guestRowOf({ personaId: 'rockzo', days: [5] }).when).toBe('days');
        expect(guestRowOf({ personaId: 'lemmy' }).when).toBe('always');
    });
});

describe('guestRowProblem', () => {
    it('asks for a host, and for nights on a fixed row', () => {
        expect(guestRowProblem(row({ personaId: '' }))).toBe('slot.guests.pickHost');
        expect(guestRowProblem(row({ when: 'days' }))).toBe('slot.guests.pickNights');
        expect(guestRowProblem(row())).toBeUndefined();
    });
});
