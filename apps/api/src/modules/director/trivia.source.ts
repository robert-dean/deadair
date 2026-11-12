import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { FactRepository, type TriviaClaim } from '#modules/enrichment/fact.repository.js';
import { FACT_COOLDOWN_MS, MAX_FACT_CHARS } from '#modules/enrichment/enrichment.read.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { TRIVIA_KIND } from './trivia.kind.js';

/**
 * The claims a trivia break is written from, read once and handed to whichever writer takes it.
 *
 * `AlmanacSource`'s sibling, and it exists for the same reason: what is decided ONCE (which claims,
 * in which order, with which already resting) is decided here, so the model binding and the floor
 * under it see exactly the same substrate, and the floor does no I/O of its own.
 *
 * ## What it reads is the station's own fact store, and nothing else
 *
 * A trivia break is the one kind where the obvious build is a model saying something interesting it
 * remembers, and that is the one build this station refuses: a claim with no source is
 * indistinguishable on air from one with a source (`docs/internals/breaks.md` § "A claim needs its
 * evidence"). So the substrate is `deadair.facts`, every row of which carries the URL and the quote
 * that support it, read across the music this station has actually played rather than the two
 * records either side of the slot. See {@link FactRepository.findTrivia} for how it is narrowed.
 *
 * ## No setting, and no subject
 *
 * The almanac's argument: a band names `trivia` and nothing else, because "a piece of trivia" is not a
 * choice with anything in it. What an operator does choose is the phrasings, which are a setting on
 * the floor.
 *
 * ## Spent by the WRITER, not here
 *
 * `SaidLog`'s lesson, which the bulletin learned by losing seven breaks in two hours: selecting is not
 * saying, and a source that rested every claim it handed over would rest six claims for every break
 * and all of them for one that was declined. So this reads UNSTAMPED and the writer that put a claim
 * in a script calls `markUsed` on that one. A claim the floor read out is spent; a claim the model
 * named is spent, judged by `mentionsFact`; the other five go back to the store untouched.
 *
 * ## Two ways of having nothing
 *
 * No claims at all, which is a fresh install or a station whose enrichment has nothing to read, and
 * every claim resting, which is a store this station has worked through faster than the cooldown
 * lets it back. Said at `info`, because a band on the clock that is silent every hour is something an
 * operator has to be told about, and the fix for each is different.
 */

/** One claim as a trivia writer is handed it. */
export interface TriviaFact {
    /** The stored claim's id, so the writer that says it can rest it. */
    factId: string;
    /** The claim itself, exactly as the store holds it. */
    claim: string;
    /**
     * What it is about, as a listener would hear it named: `Glory Box, by Portishead`, `Dummy, by
     * Portishead`, `Portishead`. Built from the catalog's own names and never from the claim.
     */
    about: string;
}

/** What a trivia break was given to say. */
export interface TriviaReport {
    /** The claims, in the order this station reaches for them. Absent when there is nothing to say. */
    trivia?: TriviaFact[];
}

/**
 * How many claims a writer is handed.
 *
 * Six, the almanac's number for its reason: enough that a model can pick the one a music station
 * would want, and few enough that the prompt is not a list it will read out. The floor takes the
 * first, which the store's order has already made the best one.
 */
export const TRIVIA_SHOWN = 6;

@Injectable()
export class TriviaSource {
    constructor(
        private readonly facts: FactRepository,
        private readonly logger: Logger,
    ) {}

    /**
     * What this break has to say, or `undefined` when it is not a trivia break.
     *
     * @param kind - The segment's kind. Anything but `trivia` answers `undefined`, which keeps the
     *   request builder free of a branch about trivia.
     */
    async factsFor(kind: string): Promise<TriviaReport | undefined> {
        if (kind !== TRIVIA_KIND) return undefined;

        try {
            const claims = await this.facts.findTrivia(FACT_COOLDOWN_MS, TRIVIA_SHOWN, MAX_FACT_CHARS);
            if (claims.length === 0) {
                this.logger.info(
                    'director: a trivia break had nothing to say, so the station passed over the slot. Either nothing the station has played has ' +
                        'facts yet (enrichment fills them in as records are looked up), or every one has been said in the last week.',
                );
                return {};
            }

            return { trivia: claims.map(triviaFactOf) };
        } catch (error) {
            // Absorbed for the reason every source absorbs: a slot the station passes over is a thing
            // it is built to do, and a throw would take the job with it.
            this.logger.warn(`director: a trivia break could not be prepared (${errorText(error)})`);
            return {};
        }
    }
}

/** A stored claim as a writer is handed it, with its subject named the way a presenter names one. */
export function triviaFactOf(claim: TriviaClaim): TriviaFact {
    return { factId: claim.id, claim: claim.claim.trim(), about: claim.artist === undefined ? claim.name : `${claim.name}, by ${claim.artist}` };
}
