import type { Persona, PersonaInput } from '@deadair/sdk';

/** What a character may be cast as. Absent on the wire means `host`, which is what every row was before callers. */
export type PersonaKind = NonNullable<PersonaInput['kind']>;

/** Every kind, in the order the API ranks them (`PERSONA_KINDS`): the first one a character has is its heading. */
export const PERSONA_KINDS: readonly PersonaKind[] = ['host', 'caller', 'newsreader', 'guest'];

/**
 * What a persona may be cast as, with the absent cases resolved the one way the API resolves them:
 * `kinds` if the row has them, else its one `kind`, else `host`. In the API's order, so the first is
 * the heading it is listed under.
 */
export const kindsOf = (persona: Pick<Persona, 'kind' | 'kinds'>): PersonaKind[] => {
    const held = new Set<PersonaKind>(persona.kinds ?? [persona.kind ?? 'host']);
    const kinds = PERSONA_KINDS.filter(kind => held.has(kind));
    return kinds.length > 0 ? kinds : ['host'];
};

/** The one kind a persona is listed under: the first of {@link kindsOf}, so anybody who presents is a host. */
export const kindOf = (persona: Pick<Persona, 'kind' | 'kinds'>): PersonaKind => kindsOf(persona)[0] ?? 'host';

/** Whether this character may be cast as `kind`. */
export const hasKind = (persona: Pick<Persona, 'kind' | 'kinds'>, kind: PersonaKind): boolean => kindsOf(persona).includes(kind);

/**
 * Whether this character can be put on air.
 *
 * `GET /personas` answers with the whole roster — hosts and callers in one list, because they are one
 * table and the personas page draws both — so every surface that OFFERS a host has to narrow it here.
 * Three of them did not: the on-air menu, the "Hosted by" field on a slot and a production's
 * "Presenter" all listed the callers, and picking one was not cosmetic. The per-broadcast binding took
 * any persona that existed, so a caller picked from that menu presented the show and the breaks were
 * written in a character whose whole premise is that it is phoning IN.
 *
 * It is a predicate rather than a copied comparison because that comparison was already written twice
 * and each new picker was a fourth chance to forget it. Presenting is the `host` kind, whatever else a
 * character is: a host who also drops by somebody else's show still presents their own.
 */
export const presents = (persona: Pick<Persona, 'kind' | 'kinds'>): boolean => hasKind(persona, 'host');
