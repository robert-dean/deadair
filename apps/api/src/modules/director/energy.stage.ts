import type { EnergyThird } from '#modules/analysis/energy.rank.js';

/**
 * The energy a show builds up or winds down through: a slot's `energyStages`, as the code reads them.
 *
 * Stages in order across the slot, as the mood stages are (`mood.stage.ts`): `[low, medium, high]` is
 * a show that builds, the reverse one that winds down, a single value one that leans the whole slot one
 * way. Each names a THIRD of the records being chosen between at the time, never a level in the
 * library, which is what lets a dark techno show and a seventies rock show each build through their
 * own records (`analysis/energy.rank.ts`). A lean, and never a filter: a hard rule about energy is a
 * mix flow's job.
 *
 * Carried on the running order in `StationLineupRules`, as the mix flow is, rather than in a column of
 * its own: it is read where the choice is made and travels with the other choice rules through
 * `reprogramme`.
 */

/** The three thirds a stage can name, low to high. */
export const ENERGY_LEVELS = ['low', 'medium', 'high'] as const satisfies readonly EnergyThird[];

/** How many energy stages a slot or a broadcast may pass through: as many as the mood stages. */
export const MAX_ENERGY_STAGES = 4;

/**
 * A stored or sent list of energy stages as the code reads it: the known levels only, in order, at most
 * {@link MAX_ENERGY_STAGES}, and `undefined` rather than an empty list, so "no lean" has one spelling.
 * Repeats are kept: `[low, low, high]` holds two thirds of a slot down and lifts the last.
 */
export function energyStages(values: readonly unknown[] | null | undefined): EnergyThird[] | undefined {
    const stages = (values ?? [])
        .filter((value): value is EnergyThird => (ENERGY_LEVELS as readonly unknown[]).includes(value))
        .slice(0, MAX_ENERGY_STAGES);
    return stages.length === 0 ? undefined : stages;
}

/** {@link energyStages} as a field to spread: `{ energyStages }`, or nothing at all for no lean. */
export function energyStagesField(values: readonly unknown[] | null | undefined): { energyStages?: EnergyThird[] } {
    const stages = energyStages(values);
    return stages === undefined ? {} : { energyStages: stages };
}
