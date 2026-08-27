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
import { planProduction, turnsFor } from '../../../src/modules/productions/production.plan.js';

const persona = (key: string) => ({ id: `id-${key}`, key, djName: key.toUpperCase(), voice: key });

const cast = (callers: number): ProductionCast => [
    hostMember(persona('classic'), 'production-1'),
    ...Array.from({ length: callers }, (_, index) => callerMember(persona(`caller${index}`), 'production-1')),
];

describe('a cast', () => {
    it('is a dialogue only once somebody is phoning in', () => {
        expect(isDialogue(cast(0))).toBe(false);
        expect(isDialogue(cast(1))).toBe(true);
        expect(isDialogue(undefined)).toBe(false);
    });

    it('carries the persona, the on-air name and the voice, because the row outlives the character', () => {
        expect(callerMember(persona('skeptic'), 'production-1')).toEqual({
            role: 'caller',
            personaId: 'id-skeptic',
            personaKey: 'skeptic',
            name: 'SKEPTIC',
            voice: 'skeptic',
        });
    });

    describe('a preoccupation', () => {
        const skeptic = { ...persona('skeptic'), preoccupations: ['the plant', 'the sky', 'the running order'] };

        // The whole reason it is decided here rather than per beat: somebody who rang up about three
        // different things over four minutes is not a person.
        it('is one per programme, so every beat this character writes carries the same one', () => {
            const first = callerMember(skeptic, 'production-1');
            const again = callerMember(skeptic, 'production-1');

            expect(first.preoccupation).toBeDefined();
            expect(again.preoccupation).toBe(first.preoccupation);
        });

        it('is a different one on a different programme', () => {
            const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(id => callerMember(skeptic, id).preoccupation));

            expect(spread.size).toBeGreaterThan(1);
        });

        it('is absent for a character with none, which is every seed the station shipped with', () => {
            expect(callerMember(persona('skeptic'), 'production-1').preoccupation).toBeUndefined();
        });

        // The cast is a jsonb column and a snapshot: a programme resumed after a restart has to read
        // back the subject its beats were already written against.
        it('survives being stored and read back', () => {
            const stored = coerceCast(JSON.parse(JSON.stringify([callerMember(skeptic, 'production-1')])));

            expect(stored?.[0]?.preoccupation).toBe(callerMember(skeptic, 'production-1').preoccupation);
        });
    });

    it('has a host even when the station is presenting as nobody', () => {
        // An ordinary state: a station with no personas at all still makes productions, and the
        // speech plugin's own default voice reads them.
        expect(hostMember(undefined, 'production-1')).toEqual({ role: 'host' });
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

    // The scale moved with `TURN_BAND`. A turn is thirty words rather than seventy now, so a
    // three-minute call is eleven turns where it used to be seven — and at the old
    // `TURNS_PER_CALLER` that same call would have cast TWO people, with a fifteen-turn one casting
    // three. A switchboard inside three minutes is the failure `MAX_CALLERS` is documented against,
    // arriving through a door it does not cover.
    it('still casts one for a call that merely has more turns in it', () => {
        expect(callerCount(9, 5)).toBe(1);
        expect(callerCount(15, 5)).toBe(1);
    });

    it('casts a second only once there are turns for both of them', () => {
        expect(callerCount(21, 5)).toBeGreaterThan(1);
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
        expect(coerceCast([{ personaKey: 'classic' }, { role: 'caller', personaKey: 'skeptic' }])).toEqual([
            { role: 'caller', personaKey: 'skeptic' },
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

// The bug the first live run of this found, and the seam it lived in. Casting asks how many TURNS
// there would be, and that estimate has to be taken in the dialogue band: a three-minute call-in is
// seven turns and two monologue beats, and two is below the floor for casting anybody — so the
// station made a phone-in with nobody on the phone and nothing said why.
describe('deciding a cast from a length', () => {
    it('casts somebody into a call-in of the length one actually gets asked for', () => {
        for (const minutes of [2, 3, 5, 10]) {
            expect(callerCount(turnsFor(minutes * 60_000), 5), `${minutes} minutes`).toBeGreaterThan(0);
        }
    });

    it('would cast nobody if the estimate were taken in the monologue band, which is the regression', () => {
        // Kept as the record of what went wrong rather than as a rule: this is the number the code
        // used to hand the caster.
        expect(planProduction(3 * 60_000).beats.length).toBeLessThan(MIN_TURNS_FOR_A_CALLER);
    });
});
