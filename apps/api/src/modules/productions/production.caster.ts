import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { callerCount, callerMember, hostMember, type ProductionCast } from './production.cast.js';
import { dialogueKinds } from './production.settings.js';
import type { Production } from './production.js';

/**
 * Who is on this programme.
 *
 * ## Casting is the station's, and it happens once
 *
 * The first pass that runs asks for a cast and stores it on the row. Not at commission, because the
 * format clock reads three hours ahead and the roster can change in between; not per beat, because a
 * production whose caller changed identity half way through is not a programme.
 *
 * ## Who rings in is a ROTATION, not a choice
 *
 * Least recently heard first, which is the same shape `chooseFacts` and the notebook already use and
 * for the same reason: a station with five callers that always picks the first one has one caller.
 * Recency comes from `deadair.segments` — the beats a character has actually spoken — rather than
 * from a column of its own, because that row already exists and a second record of the same fact is
 * a second thing that can be wrong.
 *
 * ## A station with no callers is an ordinary state
 *
 * It casts the host alone, the planner uses the monologue band, and what comes out is exactly the
 * production the station made before any of this existed. Nothing here can fail a production: a
 * caller nobody could look up is a programme with one voice, which is worse than it might have been
 * and better than nothing going out.
 */
@Injectable()
export class ProductionCaster {
    constructor(
        private readonly personas: PersonaRepository,
        private readonly segments: SegmentRepository,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * The cast for this production: the presenter, then whoever is phoning in.
     *
     * `turns` is how many the plan would have if this were a monologue, which is only used to decide
     * HOW MANY callers are worth casting — the real turn count is computed afterwards, from the band
     * the cast turns out to call for. That order is deliberate: the alternative is a plan that has to
     * be thrown away and recomputed once the cast is known.
     */
    async cast(production: Production, turns: number): Promise<ProductionCast> {
        // Who is presenting, resolved the one way everything resolves it.
        const host = hostMember(await this.personas.presenting(production.personaId), production.id);
        if (!this.wantsCallers(production.kind)) return [host];

        try {
            const roster = await this.personas.castable();
            const wanted = callerCount(turns, roster.length);
            if (wanted === 0) return [host];

            const chosen = (await this.leastRecent(roster.map(persona => persona.id))).slice(0, wanted);
            const callers = chosen.flatMap(id => {
                const persona = roster.find(candidate => candidate.id === id);
                return persona === undefined ? [] : [callerMember(persona, production.id)];
            });

            if (callers.length === 0) return [host];

            this.logger.info('productions: cast somebody to ring in', {
                production: production.id,
                callers: callers.map(caller => caller.personaKey ?? '').join(', '),
            });
            return [host, ...callers];
        } catch (error) {
            // A production with one voice, which is what every one of them was until recently. The
            // alternative is failing a programme over who was going to be on it.
            this.logger.warn(`productions: nobody could be cast to ring in, so this one is the presenter alone (${errorText(error)})`, {
                production: production.id,
            });
            return [host];
        }
    }

    /** Whether a production of this kind has anybody phone in. */
    private wantsCallers(kind: string): boolean {
        return dialogueKinds(this.config).has(kind.trim().toLowerCase());
    }

    /**
     * The roster, least recently heard first.
     *
     * Ids rather than personas, because what this actually asks is a question about segments. A
     * character who has never spoken sorts to the front, which is what makes a newly written caller
     * the next one cast rather than the last.
     */
    private async leastRecent(ids: readonly string[]): Promise<string[]> {
        const heard = await this.segments.lastSpokenBy(ids);

        return [...ids].sort((left, right) => (heard.get(left) ?? 0) - (heard.get(right) ?? 0));
    }
}
