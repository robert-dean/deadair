/**
 * Who is in a production, and who speaks which beat.
 *
 * ## The cast is decided once, and the turns are arithmetic
 *
 * The same rule as `production.plan.ts` one file over, and for the same reason. The model supplies
 * CONTENT: what a beat is about, what it plants, what it lands. It does not decide how long a beat
 * is and it does not decide who says it, because both of those are facts the station has to be able
 * to act on afterwards — a beat is rendered in one voice and stamped with one persona, and a model
 * that named a speaker the production was never given would be a beat drafted as one character and
 * spoken as another.
 *
 * `OutlineBeat.lead` used to be the field for the other design, where the outline named the speaker.
 * It is gone. What replaced it is {@link BeatPlan.speaker}, which is an index into this cast and is
 * written before the outline is asked for anything — so the outline can be TOLD who has each beat
 * and plan its content to fit, which is the useful half of what `lead` was for, without any of the
 * risk.
 *
 * ## A cast of one is what the station already did
 *
 * Every production before callers was the presenter reading for ten minutes, and that is a cast with
 * one member. Nothing here has a special case for it: one member means every beat is theirs, the
 * turn pattern is a straight line, and the planner uses the monologue band. That is what keeps this
 * safe to have on a station that has never cast anybody.
 */

import { preoccupationOf, type PersonaSheet } from '#modules/personas/persona.sheet.js';
// `TURN_BAND` is referenced by `{@link}` below, on the line warning that the weights here have to
// move whenever it does. Dropping the import would take that link with it, which is the one
// thing standing between a reader and a coupling the file says is not obvious.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { CALLER_TURN_WEIGHT, HOST_TURN_WEIGHT, TURN_BAND } from './production.plan.js';

/** What a member of a cast is doing here. */
export type CastRole = 'host' | 'caller';

/**
 * One person in a production.
 *
 * JSON-safe and stored as-is in `productions.casting`, so this is a snapshot rather than a
 * reference: the persona it names may be edited, or deleted, while the production is being made, and
 * what the beats were written and spoken as has to be what an operator reads back afterwards.
 */
export interface CastMember {
    role: CastRole;
    /** The persona row, while it exists. Absent for a station presenting as nobody in particular. */
    personaId?: string;
    /** The persona's key, which is what `script_history` and the notebook are keyed by. */
    personaKey?: string;
    /** What this character is called on air. The host's `djName`, or the caller's. */
    name?: string;
    /** The station voice that speaks them. Absent means the speech plugin's own default. */
    voice?: string;
    /**
     * The one thing this character has on its mind for this programme, from their sheet's
     * `preoccupations`.
     *
     * **Chosen once, here, rather than per beat**, which is the whole of why it is stored on the cast
     * rather than picked where a beat is written. Somebody who rang up about three different things
     * over four minutes is not a person, and a presenter who changes what is bothering them between
     * one turn and the next is the same failure in the station's own voice. The cast is already the
     * place a programme's identity is settled once and read many times, so this belongs on it.
     *
     * Absent for a character with none, for a station presenting as nobody, and for every cast
     * stored before this existed.
     */
    preoccupation?: string;
}

/** A cast, in the order it was assembled: the presenter first, then whoever rang in. */
export type ProductionCast = readonly CastMember[];

/** Whether this production has anybody on the phone, which is what makes it a dialogue. */
export const isDialogue = (cast: ProductionCast | undefined): boolean => (cast ?? []).some(member => member.role === 'caller');

/**
 * Who speaks each turn, as indexes into the cast.
 *
 * **The host opens and the host closes**, and the callers take the turns in between, one at a time
 * and in cast order. That is a format rather than a preference and it is why this is a function
 * rather than a setting: a phone-in where the caller has the first word is a programme that never
 * introduced itself, and one where the caller has the last word is a programme that does not end.
 *
 * Two bounds worth stating because they are what the arithmetic protects against:
 *
 * - **A cast of one gets every turn**, which is exactly the monologue the station already made.
 * - **Fewer turns than there are people is not an error.** The pattern simply runs out — the callers
 *   who did not get a turn were cast and are not heard, which reads badly on a page and matters not
 *   at all on air. {@link castFor} is what stops it happening, by casting from the turn count.
 */
export function speakerOrder(cast: ProductionCast, turns: number): number[] {
    if (turns <= 0) return [];
    const callers = cast.flatMap((member, index) => (member.role === 'caller' ? [index] : []));
    if (callers.length === 0) return Array.from({ length: turns }, () => 0);

    // The host is index 0 by construction; `hostMember` goes in first and the repository reads the
    // list back in order.
    const order: number[] = [];
    let next = 0;
    for (let turn = 0; turn < turns; turn++) {
        // Strict alternation, except that the last turn is always the host's. `planProduction` keeps
        // a dialogue's turn count ODD so the two rules never collide; an even count would otherwise
        // end on a caller, and this is what stops that rather than a shape nobody planned. The price
        // of an even count is two host turns at the end, which is a hand-off rather than a fault.
        const host = turn % 2 === 0 || turn === turns - 1;
        if (host) order.push(0);
        else {
            order.push(callers[next % callers.length]!);
            next += 1;
        }
    }

    return order;
}

/**
 * What each turn's share of the budget is worth, given who is taking it.
 *
 * Role knowledge lives here rather than in `production.plan.ts`, which is pure arithmetic and should
 * stay that way — it takes the numbers and knows nothing about who produced them.
 *
 * The failure this answers is that the budget used to be split EVENLY, so a host turn and a caller
 * turn were the same length. A phone-in is not symmetrical in either direction: the host asks a
 * short question and hands over, and the caller answers at length. Measured before it, every turn of
 * every call this station made came out between 58 and 78 words, host and caller alike, which is why
 * none of them sounded like a conversation.
 *
 * A cast with no callers answers a flat list, which {@link planProduction} treats as an even split.
 */
export function turnWeights(cast: ProductionCast, speakers: readonly number[]): number[] {
    return speakers.map(index => (cast[index]?.role === 'caller' ? CALLER_TURN_WEIGHT : HOST_TURN_WEIGHT));
}

/**
 * How many callers a production of this many turns wants.
 *
 * Arithmetic, and deliberately conservative: one caller for a short block, a second only once there
 * are enough turns for both of them to say something worth hearing. A programme that casts four
 * people into six turns is a switchboard rather than a conversation.
 *
 * Answers 0 for a production with no turns to give away, and never more than the roster holds.
 */
export function callerCount(turns: number, available: number): number {
    if (turns < MIN_TURNS_FOR_A_CALLER || available <= 0) return 0;

    // Every second turn is a caller's, and each of them wants at least two to be worth casting.
    const wanted = Math.max(1, Math.floor(Math.floor(turns / 2) / TURNS_PER_CALLER));
    return Math.min(wanted, available, MAX_CALLERS);
}

/**
 * The fewest turns worth putting somebody on the phone for.
 *
 * Three: the host introduces them, they say their piece, the host answers. Two would be a caller
 * with the last word, which the turn pattern does not allow anyway.
 */
export const MIN_TURNS_FOR_A_CALLER = 3;

/**
 * How many of a caller's own turns are worth casting a second caller for.
 *
 * **This has to move whenever {@link TURN_BAND} does, and it is not obvious that it does.** The
 * number is a proxy for how much AIRTIME a caller gets, and it was calibrated against seventy-word
 * turns: at two, a caller earned their place with two turns, which was most of three minutes.
 *
 * With turns at thirty words the same arithmetic casts two callers into an eleven-turn call and
 * three into a fifteen-turn one — a switchboard inside three minutes, which is precisely the failure
 * {@link MAX_CALLERS} is documented against, arriving through a door it does not cover. Five keeps a
 * short call at one caller and starts casting a second only where there is genuinely room for both.
 */
export const TURNS_PER_CALLER = 5;

/**
 * A ceiling on how many people are on one programme.
 *
 * Not a resource limit — casting is a database read — but a format one: past three the listener is
 * being introduced to somebody new every thirty seconds and none of them is a character.
 */
export const MAX_CALLERS = 3;

/**
 * The presenter as a cast member, or a station presenting as nobody in particular.
 *
 * `productionId` is what their preoccupation is spread over, so the whole programme carries one and
 * the next programme carries a different one. Both people on a call rotate over the SAME id, which
 * is deliberate and costs nothing: their lists are their own, so two characters landing on the same
 * index are still on about two different things.
 */
export function hostMember(persona: PersonaToCast | undefined, productionId: string): CastMember {
    if (persona === undefined) return { role: 'host' };

    const preoccupation = preoccupationOf(persona, productionId);

    return {
        role: 'host',
        personaId: persona.id,
        personaKey: persona.key,
        ...(persona.djName === undefined ? {} : { name: persona.djName }),
        ...(persona.voice === undefined ? {} : { voice: persona.voice }),
        ...(preoccupation === undefined ? {} : { preoccupation }),
    };
}

/** A caller as a cast member. Same shape, different role, which is the whole of the difference here. */
export function callerMember(persona: PersonaToCast, productionId: string): CastMember {
    return { ...hostMember(persona, productionId), role: 'caller' };
}

/**
 * What casting needs off a persona row.
 *
 * The sheet half is `PersonaSheet` itself rather than the one field read out of it, because
 * `preoccupationOf` applies the sheet's own cap and normalizer and a narrower parameter here would
 * be this file holding an opinion about which entries are eligible.
 */
type PersonaToCast = PersonaSheet & { id: string; key: string; djName?: string; voice?: string };

/**
 * Read a stored cast back, keeping only what is usable.
 *
 * Defensive for `PersonaRepository`'s reason: this is a jsonb column, and a row edited by hand or
 * written by an older shape must cost the production its cast rather than crashing the pass that
 * reads it. A member with no role is not a member.
 */
export function coerceCast(raw: unknown): ProductionCast | undefined {
    if (!Array.isArray(raw)) return undefined;

    const members = raw
        .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object')
        .flatMap(entry => {
            const role = entry.role;
            if (role !== 'host' && role !== 'caller') return [];

            return [
                {
                    role,
                    ...text('personaId', entry.personaId),
                    ...text('personaKey', entry.personaKey),
                    ...text('name', entry.name),
                    ...text('voice', entry.voice),
                    ...text('preoccupation', entry.preoccupation),
                } satisfies CastMember,
            ];
        });

    return members.length === 0 ? undefined : members;
}

/** A key at a usable string, or nothing at all. */
function text<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
    if (typeof value !== 'string') return {};
    const trimmed = value.trim();
    return trimmed.length === 0 ? {} : ({ [key]: trimmed } as Record<K, string>);
}
