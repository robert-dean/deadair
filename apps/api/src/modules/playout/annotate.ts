/**
 * Liquidsoap's `annotate:` protocol: the metadata that rides through the player
 * on the pushed uri.
 *
 * It carries two different things, for two different audiences. The item id
 * comes back on the `on_track` notify and in every reading of the queue, which
 * is how the app learns what actually went on air rather than inferring it from
 * what it last handed over. The track's title and artist go the other way, out
 * to the listener: Liquidsoap is playing a file it fetched from a URL we handed
 * it, and for a Spotify item that file carries no usable tags at all, so
 * whatever the app says here is the only thing the mount can be labelled with.
 *
 * Neither failure mode is loud — a malformed annotation either fails to resolve
 * (silence) or resolves without the id (the notify goes missing) — so this is
 * kept pure and unit-tested.
 */

import type { RundownItem } from './rundown.js';

/** The metadata key carrying the rundown item id. Must match `radio.liq`. */
export const ITEM_KEY = 'deadair_item';

/**
 * The annotations one item goes to the player with.
 *
 * `title`, `artist` and `album` are Liquidsoap's own metadata names, not ours:
 * `output.icecast` builds the ICY stream title out of what the source is
 * playing, so setting them here is what puts the track in a listener's player.
 * That is also why this is the labelling path rather than Icecast's admin API —
 * the label travels with the item, so it changes on the boundary itself and
 * needs no second credential to push it.
 *
 * Empty values are left out rather than sent blank: an `artist=""` overwrites
 * whatever the file's own tags said with nothing, and for a local library those
 * tags are better than silence.
 */
export function itemAnnotations(item: RundownItem): Record<string, string> {
    const artist = item.artists.join(', ');
    return {
        [ITEM_KEY]: item.id,
        ...(item.title ? { title: item.title } : {}),
        ...(artist ? { artist } : {}),
        ...(item.album ? { album: item.album } : {}),
    };
}

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
