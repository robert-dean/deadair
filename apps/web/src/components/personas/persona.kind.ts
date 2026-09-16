import type { Persona, PersonaInput } from '@deadair/sdk';

/** What a character is for. Absent on the wire means `host`, which is what every row was before callers. */
export type PersonaKind = NonNullable<PersonaInput['kind']>;

/** What a persona is for, with the absent case resolved the one way the API resolves it (`DEFAULT_PERSONA_KIND`). */
export const kindOf = (persona: Persona): PersonaKind => persona.kind ?? 'host';

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
 * It is a predicate rather than a copied `kind !== 'caller'` because that comparison was already
 * written twice and each new picker was a fourth chance to forget it. The contract's word is the
 * authority: a caller "is cast per programme, and can never be put on air".
 */
export const presents = (persona: Persona): boolean => kindOf(persona) === 'host';
