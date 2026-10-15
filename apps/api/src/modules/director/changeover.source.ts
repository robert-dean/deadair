import { Injectable } from 'injectkit';
import type { Persona } from '#modules/personas/persona.js';
import { PersonaRepository } from '#modules/personas/persona.repository.js';
import type { BreakContext } from './break.request.js';
import type { BreakChangeover } from './break.writer.js';
import { CHANGEOVER_KIND } from './changeover.writer.js';

/**
 * What a changeover break is about: the programme that ended and the one that started.
 *
 * The fourth of the sources `WriteBreakJob` reads as a chain, beside `BulletinSource`,
 * `WeatherSource` and `AlmanacSource`, and on their terms: it refuses every kind but its own, so the
 * job holds no branch about changeovers, and it resolves the request's context once so the model
 * binding and the floor cannot resolve it differently.
 *
 * ## What the request carries, and what this adds
 *
 * The request carries what was true at the moment the clock changed the station over: the outgoing
 * broadcast's host id as it stood on the running order (absent when that broadcast named none), the
 * ids of the co-hosts who presented beside them, and the two show names. It carries an ID rather than a name so the writer is handed the persona itself,
 * which is what the model binding needs to say who they were and what the floor needs for their name.
 *
 * What this adds is the one judgement a writer must not make for itself: **whether the outgoing host
 * is somebody else.** Both sides are resolved through `PersonaRepository.presenting`, the one place
 * the precedence lives, so a broadcast that named no host is compared as the station's default host,
 * which is who presented it. The same host on both sides answers with no `outgoing` at all.
 *
 * The co-hosts are thanked too, because they presented the show as much as its lead did: a changeover
 * from a two-hander that thanks one of the two is the other one written out of their own show. Each
 * is compared the same way, so a co-host who is presenting the new show is not thanked either.
 */

/** The keys a changeover request stores in `break_requests.context`. One place, so writer and reader agree. */
export const CHANGEOVER_CONTEXT = {
    outgoingPersonaId: 'outgoingPersonaId',
    outgoingCoHostPersonaIds: 'outgoingCoHostPersonaIds',
    outgoingShow: 'outgoingShow',
    incomingShow: 'incomingShow',
} as const;

/** What the trigger knows at the moment of the changeover. */
export interface ChangeoverFacts {
    outgoingPersonaId?: string;
    /** Who presented beside the outgoing host, in the order the show named them. */
    outgoingCoHostPersonaIds?: readonly string[];
    outgoingShow?: string;
    incomingShow?: string;
}

/**
 * The facts, as a request's context.
 *
 * A context is stored, so the JSON-safe rule covers it; every value here is a string, and an absent
 * fact is an absent key rather than an empty string, which a reader would have to know to ignore.
 * The co-hosts are one comma-separated value, because a context holds scalars only; persona ids are
 * UUIDs, so a comma is never part of one.
 */
export function changeoverContext(facts: ChangeoverFacts): BreakContext {
    const context: BreakContext = {};
    const { outgoingCoHostPersonaIds, ...single } = facts;
    for (const key of [CHANGEOVER_CONTEXT.outgoingPersonaId, CHANGEOVER_CONTEXT.outgoingShow, CHANGEOVER_CONTEXT.incomingShow] as const) {
        const value = single[key]?.trim();
        if (value !== undefined && value.length > 0) context[key] = value;
    }

    const coHosts = (outgoingCoHostPersonaIds ?? []).map(id => id.trim()).filter(id => id.length > 0);
    if (coHosts.length > 0) context[CHANGEOVER_CONTEXT.outgoingCoHostPersonaIds] = coHosts.join(',');

    return context;
}

/** A context value as text, or `undefined` for anything else. A context is shapeless by design. */
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

/** The co-host ids out of their one stored value, in order and without repeats. */
const ids = (value: unknown): string[] => [
    ...new Set(
        (text(value) ?? '')
            .split(',')
            .map(id => id.trim())
            .filter(id => id.length > 0),
    ),
];

@Injectable()
export class ChangeoverSource {
    constructor(private readonly personas: PersonaRepository) {}

    /**
     * The substrate for a changeover, or `undefined` for every other kind.
     *
     * @param presenting - Who is presenting the new broadcast, as `WriteBreakJob` already resolved it.
     *   Passed in rather than resolved again, so the comparison is against the very persona the break
     *   will be written under.
     */
    async changeoverFor(kind: string, context: BreakContext | undefined, presenting: Persona | undefined): Promise<BreakChangeover | undefined> {
        if (kind !== CHANGEOVER_KIND) return undefined;

        const outgoing = await this.personas.presenting(text(context?.[CHANGEOVER_CONTEXT.outgoingPersonaId]));
        const outgoingShow = text(context?.[CHANGEOVER_CONTEXT.outgoingShow]);
        const incomingShow = text(context?.[CHANGEOVER_CONTEXT.incomingShow]);
        // `find` rather than `presenting`: a co-host is somebody the show named, never the station's
        // default standing in for nobody. One the roster cannot read is passed over rather than
        // failing the break, as `WriteBreakJob.speakerFor` passes one over.
        const found = await Promise.all(
            ids(context?.[CHANGEOVER_CONTEXT.outgoingCoHostPersonaIds]).map(id => this.personas.find(id).catch(() => undefined)),
        );
        const outgoingCoHosts = found.filter(
            (persona): persona is Persona => persona !== undefined && persona.id !== presenting?.id && persona.id !== outgoing?.id,
        );

        return {
            // Somebody else, or nobody. A station with no persona at all has neither side and thanks
            // nobody, which is the station it was before personas existed.
            ...(outgoing === undefined || outgoing.id === presenting?.id ? {} : { outgoing }),
            ...(outgoingCoHosts.length === 0 ? {} : { outgoingCoHosts }),
            ...(outgoingShow === undefined ? {} : { outgoingShow }),
            ...(incomingShow === undefined ? {} : { incomingShow }),
        };
    }
}
