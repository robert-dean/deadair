/**
 * The scheme a persona's portrait is keyed under, and the only place it is spelled.
 *
 * The same borrowing `break.art.ts` makes, and for its reason: `art_assets.source_url` is the stable
 * identity of a picture, and a portrait has no upstream to fetch, so the persona's id IS its identity.
 * Replacing the picture keeps the row and its id, so a URL already handed to a listener's player keeps
 * working and the ETag is what says it moved. Never fetched, for the reasons that file gives: the row is
 * only ever written with its bytes, and the cache sweeper refuses anything that is not `http`.
 */
export const PERSONA_ART_SOURCE = 'deadair:persona-art';

/** The key one persona's portrait is stored under. */
export const personaArtKey = (personaId: string): string => `${PERSONA_ART_SOURCE}/${personaId}`;

/** Whether a key belongs to a persona's portrait, which `ArtService` serves `no-cache` because it can be replaced under one id. */
export const isPersonaArtKey = (sourceUrl: string): boolean => sourceUrl.startsWith(`${PERSONA_ART_SOURCE}/`);

/** A persona id as the personas table issues them, which is all a key may hold. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a string can be a persona id here. A route param, so it is checked rather than trusted. */
export const personaIdIsSafe = (personaId: string): boolean => UUID.test(personaId);
