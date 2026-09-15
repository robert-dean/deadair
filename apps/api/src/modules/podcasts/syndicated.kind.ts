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
