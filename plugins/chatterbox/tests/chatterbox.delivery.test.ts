// What `hushed` and `frantic` become on this engine. Pure arithmetic, so what is pinned is the shape of
// the translation rather than whether it sounds right: a delivery moves a voice from wherever it is,
// the baseline falls back row, server, neutral in that order, and the engine never sees a number
// outside the range its own interface offers.

import { describe, expect, it } from 'vitest';

import { DELIVERY_OFFSETS, dialsFor, needsServerDefaults, NEUTRAL_DIALS } from '../src/chatterbox.delivery.js';

describe('dialsFor', () => {
    it('sends only what the row set when no delivery was asked for', () => {
        expect(dialsFor({ engine: 'Olivia.wav' })).toEqual({});
        expect(dialsFor({ engine: 'Jeremiah.wav', exaggeration: 0.8 })).toEqual({ exaggeration: 0.8 });
        expect(dialsFor({ engine: 'Jeremiah.wav', exaggeration: 0.8, cfgWeight: 0.3 }, undefined, { exaggeration: 1.3 })).toEqual({
            exaggeration: 0.8,
            cfg_weight: 0.3,
        });
    });

    it('moves a voice from its own baseline, so an intense one stays more intense when hushed', () => {
        const intense = { engine: 'Jeremiah.wav', exaggeration: 0.8, cfgWeight: 0.4 };
        const calm = { engine: 'Olivia.wav', exaggeration: 0.4, cfgWeight: 0.5 };

        expect(dialsFor(intense, 'frantic')).toEqual({ exaggeration: 1.2, cfg_weight: 0.4 });
        expect(dialsFor(intense, 'hushed')).toEqual({ exaggeration: 0.55, cfg_weight: 0.2 });
        expect(dialsFor(intense, 'hushed').exaggeration!).toBeGreaterThan(dialsFor(calm, 'hushed').exaggeration!);
    });

    it("takes a blank dial from the server's own default, which is what that voice sounds like at rest", () => {
        // The station this was built against has 1.3 configured. Taken from the textbook 0.5 instead,
        // its frantic reading would have been calmer than its ordinary one.
        expect(dialsFor({ engine: 'Olivia.wav' }, 'frantic', { exaggeration: 1.3, cfgWeight: 0.5 })).toEqual({ exaggeration: 1.7, cfg_weight: 0.5 });
        expect(dialsFor({ engine: 'Olivia.wav' }, 'frantic', { exaggeration: 1.3 }).exaggeration!).toBeGreaterThan(1.3);
    });

    it('falls back to the documented neutral when neither the row nor the server says', () => {
        expect(dialsFor({ engine: 'Olivia.wav' }, 'hushed')).toEqual({
            exaggeration: NEUTRAL_DIALS.exaggeration + DELIVERY_OFFSETS.hushed.exaggeration,
            cfg_weight: NEUTRAL_DIALS.cfgWeight + DELIVERY_OFFSETS.hushed.cfgWeight,
        });
    });

    it('prefers the row over the server, dial by dial', () => {
        expect(dialsFor({ engine: 'Olivia.wav', cfgWeight: 0.2 }, 'frantic', { exaggeration: 1.0, cfgWeight: 0.9 })).toEqual({
            exaggeration: 1.4,
            cfg_weight: 0.2,
        });
    });

    it('sends both dials whenever a delivery is asked for, because a reading is the pair', () => {
        expect(Object.keys(dialsFor({ engine: 'Olivia.wav', exaggeration: 0.7 }, 'hushed')).sort()).toEqual(['cfg_weight', 'exaggeration']);
    });

    it("clamps into the engine's range rather than sending a number its own interface does not offer", () => {
        expect(dialsFor({ engine: 'x', exaggeration: 1.9, cfgWeight: 1.9 }, 'frantic')).toEqual({ exaggeration: 2, cfg_weight: 1.9 });
        expect(dialsFor({ engine: 'x', exaggeration: 0.1, cfgWeight: 0.1 }, 'hushed')).toEqual({ exaggeration: 0, cfg_weight: 0 });
    });

    it('makes hushed quieter and frantic livelier than the ordinary reading, from any baseline', () => {
        for (const exaggeration of [0.3, 0.5, 1, 1.3]) {
            const voice = { engine: 'x', exaggeration, cfgWeight: 0.5 };
            expect(dialsFor(voice, 'hushed').exaggeration!).toBeLessThan(exaggeration);
            expect(dialsFor(voice, 'frantic').exaggeration!).toBeGreaterThan(exaggeration);
        }
    });
});

describe('needsServerDefaults', () => {
    it('is only when the row left a dial blank', () => {
        expect(needsServerDefaults({ engine: 'x', exaggeration: 0.5, cfgWeight: 0.5 })).toBe(false);
        expect(needsServerDefaults({ engine: 'x', exaggeration: 0.5 })).toBe(true);
        expect(needsServerDefaults({ engine: 'x' })).toBe(true);
    });
});
