/**
 * What `hushed` and `frantic` become on this engine.
 *
 * The station asks for a delivery in its own words and this file is the whole of the translation into
 * Chatterbox's two expressiveness dials. Another engine translates the same words into whatever it
 * has, which is why nothing here leaves the plugin.
 *
 * ## A delivery is a DIRECTION, taken from wherever the voice already is
 *
 * Each word is an offset on the voice's own baseline rather than a fixed point, so the two axes
 * compose: a character who is intense at rest (a high `exaggeration` in their row) is still more
 * intense than their neighbours when hushed, and a calm one is still calmer when frantic. A fixed
 * point would make every hushed break sound alike whoever was reading it.
 *
 * The baseline is the row's own dial, else the SERVER's configured default (which is what an omitted
 * field would have got, so it is what "this voice at rest" actually sounds like), else Resemble's
 * documented neutral. That middle step is the one that matters on a real install: the station this was
 * built against has 1.3 configured, and an offset taken from the textbook 0.5 would make its frantic
 * reading CALMER than its ordinary one.
 *
 * ## Why these numbers
 *
 * Upstream's own guidance is the whole of the evidence: 0.5 and 0.5 are neutral, an expressive reading
 * wants exaggeration up around 0.7 or more, higher exaggeration speeds a reading up, and a lower CFG
 * weight slows it back down. So `frantic` raises exaggeration and leaves CFG weight alone, because the
 * pace it gains is part of what makes it frantic. `hushed` lowers both, taking the expression out and
 * the slower, more deliberate pacing a lower CFG weight brings. They are starting points, set before
 * anybody had heard them on air, and this table is the one place to tune them by ear.
 *
 * Both dials are sent whenever a delivery is, because a reading is the pair. Sending one and leaving the
 * other to the server's default is half a delivery against an operator setting nobody can see.
 */

import type { SpeechDelivery } from '@deadair/plugin-sdk';
import { MAX_CFG_WEIGHT, MAX_EXAGGERATION, MIN_CFG_WEIGHT, MIN_EXAGGERATION, type VoiceMapping } from './chatterbox.voices.js';

/** Both dials, as numbers. */
export interface Dials {
    exaggeration: number;
    cfgWeight: number;
}

/** What the server does with a field nobody sent, as far as it would say. Either half may be missing. */
export type ServerDefaults = Partial<Dials>;

/** Resemble's documented defaults, for a voice and a server that say nothing. */
export const NEUTRAL_DIALS: Dials = { exaggeration: 0.5, cfgWeight: 0.5 };

/** How far each delivery moves a voice from its own baseline. The one place to tune them. */
export const DELIVERY_OFFSETS: Readonly<Record<SpeechDelivery, Dials>> = {
    hushed: { exaggeration: -0.25, cfgWeight: -0.2 },
    frantic: { exaggeration: 0.4, cfgWeight: 0 },
};

/** The dials as the engine's request spells them. */
export interface EngineDials {
    exaggeration?: number;
    cfg_weight?: number;
}

/**
 * What to send for one line in one voice.
 *
 * With no delivery, exactly what the row set and nothing else, so an ordinary line is the request it
 * has always been. With one, both dials: the baseline moved by the offset, clamped into the engine's
 * range, and rounded so that `0.8 + 0.4` goes out as `1.2` rather than as a float's idea of it.
 */
export function dialsFor(mapping: VoiceMapping, delivery?: SpeechDelivery, server?: ServerDefaults): EngineDials {
    if (delivery === undefined) {
        return {
            ...(mapping.exaggeration === undefined ? {} : { exaggeration: mapping.exaggeration }),
            ...(mapping.cfgWeight === undefined ? {} : { cfg_weight: mapping.cfgWeight }),
        };
    }

    const offset = DELIVERY_OFFSETS[delivery];
    const exaggeration = mapping.exaggeration ?? server?.exaggeration ?? NEUTRAL_DIALS.exaggeration;
    const cfgWeight = mapping.cfgWeight ?? server?.cfgWeight ?? NEUTRAL_DIALS.cfgWeight;

    return {
        exaggeration: within(exaggeration + offset.exaggeration, MIN_EXAGGERATION, MAX_EXAGGERATION),
        cfg_weight: within(cfgWeight + offset.cfgWeight, MIN_CFG_WEIGHT, MAX_CFG_WEIGHT),
    };
}

/** Whether a mapping needs the server's defaults to work out a delivery, which is only when it left a dial blank. */
export const needsServerDefaults = (mapping: VoiceMapping): boolean => mapping.exaggeration === undefined || mapping.cfgWeight === undefined;

const within = (value: number, min: number, max: number): number => Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
