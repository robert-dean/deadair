import { thirdsOf, type Energy, type EnergyThird } from '#modules/analysis/energy.rank.js';

/**
 * Leaning the draw toward the energy of the stretch a batch airs in, without ever narrowing it.
 *
 * A record's energy is its loudness and its brightness, each ranked against the library
 * (`analysis/energy.rank.ts`). The lean does not use the library's thirds: it takes the thirds OF THE
 * RECORDS BEING CHOSEN BETWEEN, so a show whose whole draw sits in the library's bottom third (a dark
 * techno show, a show of seventies masters) still has a low, a middle and a high of its own to build
 * through. A record in the stage's third is made more likely, by the same factor a like and a mood fit
 * get, and every other record keeps exactly the weight it had: a record in another third, one never
 * measured, one the library cannot rank. Never zero and never a filter; a hard rule about energy is a
 * mix flow's job.
 *
 * Read by the floor (`CatalogSetGenerator`) here; the shortlist and the search tool are told the stage
 * rather than leaned, since a model chooses there.
 */

/**
 * How much more likely a record in the stage's third is to be drawn: a like's factor, and a mood fit's.
 *
 * Unfitted, and said so. With a mood and an energy both named, a record fitting both is four times as
 * likely as one fitting neither, which is the like-and-mood precedent applied twice rather than a figure
 * anybody measured.
 */
export const ENERGY_BOOST = 2;

/**
 * The records among `energies` in the stage's third of that pool, or an empty set when there is no stage,
 * or too few records with an energy to split into thirds.
 */
export function inEnergyStage(energies: ReadonlyMap<string, Energy>, stage: EnergyThird | undefined): Set<string> {
    if (stage === undefined) return new Set();
    const thirds = thirdsOf(new Map([...energies].map(([trackId, energy]) => [trackId, energy.percentile])));
    if (thirds === undefined) return new Set();
    return new Set([...thirds].filter(([, third]) => third === stage).map(([trackId]) => trackId));
}
