/**
 * The kind an episode of somebody else's programme airs under: the segment's kind, the format-clock
 * band's kind and the topic kind that says which show a band means.
 *
 * Not `podcast`, which already names something else here: `render.productionKinds` defaults to
 * `podcast,callin`, so a `podcast` band is one the production scheduler commissions and the station
 * WRITES. A band carrying a show the station did not make needs a word nothing else claims, and this
 * is the one broadcasting already uses for a programme one station airs from somebody else.
 */
export const SYNDICATED_KIND = 'syndicated';

/**
 * Whether a band's kind asks for somebody else's programme.
 *
 * One function, read by the planner that fills the band, the scheduler that fetches ahead of it and
 * the clock that offers it, so the three cannot disagree about which bands are theirs. The same
 * reason `isProductionKind` is one function, and spelled the same way: trimmed and case-folded,
 * because a band's kind is free text an operator typed.
 */
export const isSyndicatedKind = (kind: string): boolean => kind.trim().toLowerCase() === SYNDICATED_KIND;
