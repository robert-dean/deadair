// Who is on a programme and who says which turn. Both are the station's arithmetic for the same
// reason the beat count is: a model that named a speaker the production was never given would be a
// turn drafted as one character and spoken in another's voice, with nothing saying so.

import { describe, expect, it } from 'vitest';

import {
    callerCount,
    callerMember,
    coerceCast,
    hostMember,
    isDialogue,
    MAX_CALLERS,
    MIN_TURNS_FOR_A_CALLER,
    speakerOrder,
    type ProductionCast,
} from '../../../src/modules/productions/production.cast.js';

const persona = (key: string) => ({ id: `id-${key}`, key, djName: key.toUpperCase(), voice: key });

const cast = (callers: number): ProductionCast => [
    hostMember(persona('classic')),
    ...Array.from({ length: callers }, (_, index) => callerMember(persona(`caller${index}`))),
];

describe('a cast', () => {
    it('is a dialogue only once somebody is phoning in', () => {
        expect(isDialogue(cast(0))).toBe(false);
        expect(isDialogue(cast(1))).toBe(true);
        expect(isDialogue(undefined)).toBe(false);
    });

    it('carries the persona, the on-air name and the voice, because the row outlives the character', () => {
        expect(callerMember(persona('theorist'))).toEqual({
            role: 'caller',
            personaId: 'id-theorist',
            personaKey: 'theorist',
            name: 'THEORIST',
            voice: 'theorist',
        });
    });

    it('has a host even when the station is presenting as nobody', () => {
        // An ordinary state: a station with no personas at all still makes productions, and the
        // speech plugin's own default voice reads them.
        expect(hostMember(undefined)).toEqual({ role: 'host' });
    });
});

describe('speakerOrder', () => {
    it('gives every turn to the presenter when nobody rang in', () => {
        expect(speakerOrder(cast(0), 4)).toEqual([0, 0, 0, 0]);
    });

    it('opens and closes with the host, and alternates in between', () => {
        expect(speakerOrder(cast(1), 5)).toEqual([0, 1, 0, 1, 0]);
    });

    it('shares the turns between callers in cast order', () => {
        expect(speakerOrder(cast(2), 7)).toEqual([0, 1, 0, 2, 0, 1, 0]);
    });

    it('never lets a caller have the last word, even on a count the planner would not produce', () => {
        // The planner keeps a dialogue's count odd so this cannot arise. It is defended anyway,
        // because the alternative is a programme that ends on somebody the host never answered.
        for (const turns of [2, 4, 6, 8]) {
            const order = speakerOrder(cast(2), turns);

            expect(order[0]).toBe(0);
            expect(order[order.length - 1]).toBe(0);
        }
    });

    it('answers nothing for a production with no turns', () => {
        expect(speakerOrder(cast(1), 0)).toEqual([]);
    });
});

describe('callerCount', () => {
    it('casts nobody for a block too short to introduce somebody in', () => {
        for (const turns of [0, 1, MIN_TURNS_FOR_A_CALLER - 1]) expect(callerCount(turns, 5)).toBe(0);
    });

    it('casts one for a short phone-in', () => {
        expect(callerCount(3, 5)).toBe(1);
        expect(callerCount(5, 5)).toBe(1);
    });

    it('casts a second only once there are turns for both of them', () => {
        expect(callerCount(9, 5)).toBeGreaterThan(1);
    });

    it('never casts more than the roster holds, or more than a listener can follow', () => {
        expect(callerCount(21, 1)).toBe(1);
        expect(callerCount(101, 20)).toBeLessThanOrEqual(MAX_CALLERS);
    });

    it('casts nobody on a station that has written no callers', () => {
        expect(callerCount(21, 0)).toBe(0);
    });
});

describe('coerceCast', () => {
    it('reads back what was stored', () => {
        expect(coerceCast([{ role: 'host', personaKey: 'classic' }])).toEqual([{ role: 'host', personaKey: 'classic' }]);
    });

    it('drops a member with no role, because that is not somebody', () => {
        expect(coerceCast([{ personaKey: 'classic' }, { role: 'caller', personaKey: 'theorist' }])).toEqual([
            { role: 'caller', personaKey: 'theorist' },
        ]);
    });

    it('answers nothing for a column holding something that is not a cast', () => {
        // jsonb hands back whatever was put in, and a production with no usable cast is a production
        // the presenter reads alone — which is worse than it might have been and better than a pass
        // that throws.
        expect(coerceCast('classic')).toBeUndefined();
        expect(coerceCast([])).toBeUndefined();
        expect(coerceCast(undefined)).toBeUndefined();
    });
});
