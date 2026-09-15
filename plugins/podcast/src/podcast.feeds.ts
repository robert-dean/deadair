import { parseRows } from '@deadair/plugin-sdk';

/**
 * The operator's subscriptions, read.
 *
 * One show per ROW, a name and a feed address, read with the SDK's own `parseRows` because that is
 * the reader the HOST uses on the same setting when it builds this plugin's allowlist from the
 * column declared `url`. `plugins/rss` makes the same argument about its own list: a show this file
 * accepts and the allowlist refuses is a show that appears in the console and never fetches, which
 * reads as a broken plugin rather than as a row typed wrong.
 *
 * Pure, and separate from the plugin, so that agreement can be table-tested with no host in the way.
 */

/** One subscription. */
export interface ConfiguredShow {
    /** Stable for as long as the subscription is; see {@link showIdFor}. */
    id: string;
    /** What the operator called it, when they did. The feed's own title is used otherwise. */
    name?: string;
    url: string;
}

/**
 * The rows an operator filled in, as shows.
 *
 * A row with no usable address is dropped and costs only itself. The same feed twice is one show,
 * the first row's, because two subscriptions to one feed would list every episode twice under two
 * ids and the station would carry it twice.
 */
export function parsePodcastRows(raw: unknown): ConfiguredShow[] {
    const shows: ConfiguredShow[] = [];
    const seen = new Set<string>();

    for (const row of parseRows(raw)) {
        const url = row.url ?? '';
        if (!isHttpUrl(url) || seen.has(url)) continue;
        seen.add(url);

        const name = row.name ?? '';
        shows.push({ id: showIdFor(url), url, ...(name.length === 0 ? {} : { name }) });
    }

    return shows;
}

/**
 * A show's id: derived from its FEED ADDRESS, and why not from anything else.
 *
 * The station keeps every episode it fetched and aired under this id, and a format-clock band names
 * a show by it, so it has to survive everything an operator does to a row except replacing the
 * subscription. That rules out the obvious two:
 *
 * - **The name**, which is `plugins/rss`'s choice and fine for a news feed nothing is keyed on. A
 *   show renamed in the settings form would become a new show, and its band would stop airing it.
 * - **The row's position**, which the console rewrites on every save.
 *
 * The host does mint a stable id per row, but only for a list that holds a credential
 * (`plugin.config.rows.ts` argues why), and this one holds none. So the address it is: renaming a
 * row keeps its id, reordering keeps it, and pointing a row at a different feed is a different show,
 * which is the truth. A publisher who moves their feed is followed by the redirect for as long as
 * they keep one, and that is the only case where the operator edits the address and loses the id.
 *
 * FNV-1a over the address as written, as hex. Not cryptographic and not asked to be: it separates
 * the handful of shows on one station, and `feed.parse.ts` hashes an entry's title the same way.
 */
export function showIdFor(url: string): string {
    let accumulated = 0x811c9dc5;

    for (let at = 0; at < url.length; at += 1) {
        accumulated ^= url.charCodeAt(at);
        accumulated = Math.imul(accumulated, 0x01000193);
    }

    return (accumulated >>> 0).toString(16).padStart(8, '0');
}

/**
 * Only http(s). `host.fetch` takes nothing else, so anything else on the list is a show that can
 * never be read; the save refuses one, and this drops one that got in some other way.
 */
function isHttpUrl(value: string): boolean {
    try {
        const { protocol } = new URL(value);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}
