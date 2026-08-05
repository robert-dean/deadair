/**
 * Liquidsoap's `annotate:` protocol, the one string that carries a rundown item
 * id through the player.
 *
 * It rides on the pushed uri and comes back on the `on_track` notify and in
 * every reading of the queue, which is how the app learns what actually went on
 * air rather than inferring it from what it last handed over. Neither failure
 * mode is loud — a malformed annotation either fails to resolve (silence) or
 * resolves without the id (the notify goes missing) — so this is kept pure and
 * unit-tested.
 */

/** The metadata key carrying the rundown item id. Must match `radio.liq`. */
export const ITEM_KEY = 'deadair_item';

/**
 * Wrap a uri in `annotate:key="value",...:uri`.
 *
 * Values are quoted, so a stream URL's own colons and query string pass through
 * untouched; quotes and backslashes inside a value are escaped.
 */
export function annotateUri(metadata: Record<string, string>, uri: string): string {
    const pairs = Object.entries(metadata).map(([key, value]) => `${key}="${value.replace(/(["\\])/g, '\\$1')}"`);
    return pairs.length === 0 ? uri : `annotate:${pairs.join(',')}:${uri}`;
}
