// Which booked live show the Desk mentions. Every stamp is the station's own clock, so the cases are
// string comparisons: a show not yet over, the earliest first, and today told from tomorrow.

import { describe, expect, it } from 'vitest';

import { nextBooking } from '../../../src/components/desk/live.booking';

const block = (label: string, start: string, end: string, live = true) => ({ slotId: label, label, start, end, ...(live ? { live } : {}) });

describe('nextBooking', () => {
    const now = '2026-11-06 18:30:00';

    it('is nothing when no live show is coming', () => {
        expect(nextBooking([block('Boneyard', '2026-11-06 18:00:00', '2026-11-06 20:00:00', false)], now)).toBeUndefined();
        expect(nextBooking([block('Earlier', '2026-11-06 10:00:00', '2026-11-06 11:00:00')], now)).toBeUndefined();
    });

    it('names the earliest one still to come, today or tomorrow', () => {
        const tomorrow = block('Tomorrow', '2026-11-07 09:15:00', '2026-11-07 10:00:00');
        const tonight = block('Tonight', '2026-11-06 20:00:00', '2026-11-06 22:00:00');

        expect(nextBooking([tomorrow, tonight], now)).toEqual({ name: 'Tonight', when: 'today', hour: 20, minute: 0 });
        expect(nextBooking([tomorrow], now)).toEqual({ name: 'Tomorrow', when: 'tomorrow', hour: 9, minute: 15 });
    });

    it('says one on now runs until its end', () => {
        expect(nextBooking([block('Pirate Hour', '2026-11-06 18:00:00', '2026-11-06 19:45:00')], now)).toEqual({
            name: 'Pirate Hour',
            when: 'now',
            hour: 19,
            minute: 45,
        });
    });
});
