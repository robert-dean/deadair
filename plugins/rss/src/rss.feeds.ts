import type { NewsFeedDescriptor } from '@deadair/plugin-sdk';

/**
 * The operator's list of feeds, read.
 *
 * One feed per line, and the address is the last `|`-separated field, because
 * that is the shape the HOST reads the same setting in when it builds this
 * plugin's allowlist (`NetworkPermissionFromConfig`). Those two readings have
 * to agree exactly: a line this file accepts and the allowlist does not is a
 * feed that appears on the menu and is refused on every fetch, which reads to
 * an operator as a broken plugin rather than as a line they typed wrong.
 *
 *     https://example.com/feed.xml
 *     world|World news|https://example.com/world.xml
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
 * Whether a line names an id and a label, and what is left after them.
 *
 * The whole line is the address when there is no `|`, which is the shape
 * somebody who has just pasted a URL will have. Two fields mean a name and an
 * address; three mean an id as well. Nothing here rejects a line for having
 * more, because the address is read from the end.
 */
export function parseFeedLines(raw: string | undefined): ConfiguredFeed[] {
    const feeds: ConfiguredFeed[] = [];
    const taken = new Set<string>();

    for (const line of (raw ?? '').split('\n').map(text => text.trim())) {
        if (line.length === 0 || line.startsWith('#')) continue;

        const fields = line.split('|').map(field => field.trim());
        const url = fields.pop() ?? '';
        if (!isHttpUrl(url)) continue;

        // `url`, `Name|url`, or `id|Name|url`. The label is whatever field sits
        // directly in front of the address, and an id in front of that.
        const label = fields.at(-1) ?? '';
        const name = label.length > 0 ? label : hostOf(url);
        const declaredId = fields.length > 1 ? (fields.at(-2) ?? '') : '';
        const id = uniqueId(slug(declaredId.length > 0 ? declaredId : name), taken);

        feeds.push({ descriptor: { id, name }, url });
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
