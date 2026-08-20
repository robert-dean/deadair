import { parseRows, type NewsFeedDescriptor } from '@deadair/plugin-sdk';

/**
 * The operator's list of feeds, read.
 *
 * One feed per ROW — a name, an address and a category — read with the SDK's own
 * `parseRows`, because that is the reader the HOST uses on the same setting when
 * it builds this plugin's allowlist (`NetworkPermissionFromConfig`, which takes
 * the cells of the columns the manifest declared `url`). Those two readings have
 * to agree exactly: a feed this file accepts and the allowlist does not is a feed
 * that appears on the menu and is refused on every fetch, which reads to an
 * operator as a broken plugin rather than as a row they got wrong.
 *
 * It was one box of `id|Name|address` lines, which is the shape a list grows the
 * moment its entries have parts, and the shape that turns a mistyped character
 * into a feed the station silently does not have. The id went with it: nobody
 * types one now, it is derived from the name, and the one thing that buys back
 * is that a feed cannot be named one thing here and referred to as another
 * somewhere else.
 *
 * Pure, and separate from the plugin for that reason: the agreement above is
 * the only thing here that can go quietly wrong, and it is worth table-testing
 * without a host in the way.
 */

/** A feed on the list, with the address the descriptor deliberately does not carry. */
export interface ConfiguredFeed {
    descriptor: NewsFeedDescriptor;
    url: string;
}

/**
 * The rows an operator filled in, as feeds.
 *
 * A row with no usable address is dropped and costs only itself, exactly as a
 * bad line did and as the allowlist does per address. The name is optional and
 * falls back to the publisher's hostname, because a pasted address with nothing
 * beside it is a perfectly ordinary way to add a feed.
 *
 * The CATEGORY is the operator's own word and is passed on untouched: what it
 * means is the station's business (it is matched against the categories the
 * station holds), and normalising it here would be this plugin having an
 * opinion about a vocabulary it cannot see.
 */
export function parseFeedRows(raw: unknown): ConfiguredFeed[] {
    const feeds: ConfiguredFeed[] = [];
    const taken = new Set<string>();

    for (const row of parseRows(raw)) {
        const url = row.url ?? '';
        if (!isHttpUrl(url)) continue;

        const label = row.name ?? '';
        const name = label.length > 0 ? label : hostOf(url);
        const category = row.category ?? '';

        feeds.push({ descriptor: { id: uniqueId(slug(name), taken), name, ...(category.length === 0 ? {} : { category }) }, url });
    }

    return feeds;
}

/**
 * An id nothing else on this list has taken.
 *
 * An operator naming two feeds the same way is not an error worth refusing a
 * line over — they may well both be called "World" at two publishers — but two
 * feeds under one id means one of them can never be asked for. So the second
 * one is suffixed, and the first keeps the id it would have had either way, so
 * that adding a feed to the bottom of the list cannot rename the ones above it.
 */
function uniqueId(base: string, taken: Set<string>): string {
    const root = base.length > 0 ? base : 'feed';

    let id = root;
    for (let suffix = 2; taken.has(id); suffix += 1) id = `${root}-${suffix}`;

    taken.add(id);
    return id;
}

/**
 * A name as an id: lowercase, dashes, nothing else.
 *
 * Not because anything downstream requires it — the host qualifies these ids
 * with the plugin that offered them and would carry any string — but because an
 * id is what a model is asked to copy back exactly, and `World news` copied
 * back as `World News` is a feed nobody can reach.
 */
const slug = (value: string): string =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

/** The publisher, for a feed the operator did not bother to name. */
function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return 'feed';
    }
}

/**
 * Only `http`/`https`, and the reason is not tidiness.
 *
 * `host.fetch` is the only egress and takes neither a `file:` nor a `data:`
 * URL, so anything else on this list is a menu entry that cannot be served. A
 * line that is a comment, a heading or a typo lands here too, and dropping it
 * is the same treatment the clock bands give a rule that does not parse.
 */
function isHttpUrl(value: string): boolean {
    try {
        const { protocol } = new URL(value);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}
