import { XMLParser } from 'fast-xml-parser';
import { plainText as asPlainText } from './html.text.js';
import { PluginError } from './plugin.error.js';
import { pluginCodeForStatus, retryAfterMs, upstreamDetail } from './plugin.http.js';
import type { HostFetchInit, PluginHost } from './plugin.host.js';

/**
 * A syndicated feed, as one shape, whichever of the three formats it arrived in.
 *
 * The sibling of `plugin.http.ts`, and here for the same reason: every plugin
 * that reads a feed writes the same normalisation, and none of it is that
 * plugin's opinion. RSS 2.0 dates an item with `pubDate` in RFC-822, Atom uses
 * `published` in ISO-8601 and RSS 1.0 uses `dc:date`; a link is an element's
 * text in two of them and an attribute in the third; a title is a bare string
 * until somebody sets `type="html"` on it and it becomes an object. None of
 * that is worth learning twice.
 *
 * ## It parses and it does not fetch
 *
 * {@link parseFeed} takes a string. That is what makes it testable against real
 * documents with no host in the way, and it is the half other plugins will
 * actually reuse. {@link fetchFeed} is the thin convenience on top, and it is
 * thin deliberately: `host.fetch` already carries the allowlist, the pacing and
 * the `Retry-After` back-off, so there is nothing left here but a status check.
 *
 * Caching and conditional GET (`ETag`, `Last-Modified`) are NOT here. They
 * belong to whoever is polling — a plugin knows how often its own feeds are
 * worth asking and this file does not — and putting a cache behind a pure
 * parser would hide it from the one caller that must not be surprised by it.
 *
 * ## Tolerant in one specific direction
 *
 * A feed is somebody else's file, served by somebody else's edge, and the ways
 * it goes wrong are not interesting: a truncated body, an HTML error page with
 * a 200 on it, an item with no title. So a document that will not parse answers
 * with no items rather than throwing, and an item missing the one field that
 * makes it an item is dropped rather than guessed at. What is NOT tolerated is
 * a bad status, because that is the upstream saying so itself.
 */

/** One entry, whatever the feed called it. */
export interface FeedItem {
    /**
     * A stable identifier for this entry, across polls and across restarts.
     *
     * The load-bearing field, and the reason it is never absent. Anything that
     * polls a feed has to tell an arrival from something it has already seen,
     * and the only alternative to an id is comparing timestamps — which fails
     * on a publisher that back-dates, re-dates or omits them.
     *
     * Taken from `guid`, then Atom's `id`, then the link, and only then a hash
     * of the title and date. The fallback is what makes the guarantee hold for
     * a feed that supplies none of the three, and it is a hash rather than an
     * index because a position in a list changes every time the list does.
     */
    id: string;
    title: string;
    /** The entry's own words, as plain text. See {@link FEED_SUMMARY_MAX_CHARS}. */
    summary?: string;
    url?: string;
    /** ISO-8601. Never a `Date`, and absent when the feed gave no readable one. */
    publishedAt?: string;
    author?: string;
    categories?: string[];
}

/** A feed, and what it holds. */
export interface ParsedFeed {
    title?: string;
    /** Where the publication itself lives, as opposed to any one entry. */
    homeUrl?: string;
    /** Newest first where the feed said, and otherwise in the order it listed them. */
    items: FeedItem[];
}

/**
 * How much of an entry's own words are kept.
 *
 * A description is written for a browser and its destination here is a model's
 * context and possibly a voice, neither of which wants three paragraphs of a
 * press release. Generous enough to hold a real first paragraph, short enough
 * that twenty of them still leave room to think.
 */
export const FEED_SUMMARY_MAX_CHARS = 500;

/**
 * `removeNSPrefix` is what makes `dc:date`, `content:encoded` and `rdf:RDF`
 * readable without a namespace table, and the cost of it is that a feed
 * carrying both `link` and `atom:link` collapses them — which every reader
 * below already handles, because a repeated element arrives as an array.
 *
 * Module-level because it is stateless and building one per document would be
 * the most expensive part of parsing a small feed.
 */
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true,
    // A guid of `12345` is an id, not a number, and a `<title>2024</title>` is a
    // title. Every field here is read as text, so parsing any of it as a number
    // only produces a value whose `.trim` is missing.
    parseTagValue: false,
    parseAttributeValue: false,
});

/**
 * A feed document, read.
 *
 * Answers with an empty feed rather than throwing, for anything that is not one
 * — a parse failure, an HTML page, an empty body. The caller's next move is the
 * same in every case, and a plugin fanning out over five feeds must not lose
 * four of them to the fifth.
 */
export function parseFeed(xml: string): ParsedFeed {
    let document: unknown;
    try {
        document = parser.parse(xml);
    } catch {
        return { items: [] };
    }

    if (!isRecord(document)) return { items: [] };

    // RSS 2.0, Atom, RSS 1.0/RDF. The `channel` of an RDF document is a sibling
    // of its items rather than their parent, which is the one structural
    // difference between the three and the reason `items` is looked up in both
    // places rather than only under the channel.
    const rss = record(document.rss);
    const rdf = record(document.RDF);
    const atom = record(document.feed);
    const channel = record(rss?.channel) ?? record(rdf?.channel) ?? atom;

    if (channel === undefined) return { items: [] };

    const entries = [...asArray(record(rss?.channel)?.item), ...asArray(rdf?.item), ...asArray(atom?.entry)];

    const feed: ParsedFeed = { items: entries.flatMap(entry => (isRecord(entry) ? (readItem(entry) ?? []) : [])) };

    const title = text(channel.title);
    if (title !== undefined) feed.title = title;

    const homeUrl = readLink(channel.link);
    if (homeUrl !== undefined) feed.homeUrl = homeUrl;

    return feed;
}

/**
 * A feed off the network.
 *
 * Everything about the request except the status check is `host.fetch`'s: the
 * allowlist, the pacing, the redirect re-checks, the body caps. What is left is
 * the one decision a plugin should not be making differently from its
 * neighbours — which {@link PluginErrorCode} a status means — and that is
 * `plugin.http.ts`'s ladder, unmodified. A service with its own reading of a
 * status layers that in front by calling {@link parseFeed} itself.
 */
export async function fetchFeed(host: PluginHost, url: string, init?: HostFetchInit): Promise<ParsedFeed> {
    const response = await host.fetch(url, init);

    if (!response.ok) {
        // The body is an error page nobody wants quoted, and reading it costs a
        // round trip against the same budget the retry would want.
        await response.body?.cancel();

        const error = new PluginError(`feed request failed: ${upstreamDetail(response.status, response.statusText)}`).withCode(
            pluginCodeForStatus(response.status),
        );
        error.upstreamStatus = response.status;

        const advice = retryAfterMs(response.headers.get('retry-after'));
        if (advice !== undefined) error.withRetry(advice);

        throw error;
    }

    return parseFeed(await response.text());
}

/**
 * One entry, or nothing when it is not one.
 *
 * A title is the only field an entry cannot be without: everything downstream
 * either names it or reads it aloud, and an entry with no title is one that
 * would air as a pause. Every other field is genuinely optional, including the
 * link, because plenty of feeds carry announcements that point nowhere.
 */
function readItem(entry: Record<string, unknown>): FeedItem | undefined {
    const title = text(entry.title);
    if (title === undefined) return undefined;

    const url = readLink(entry.link);
    const publishedAt = readDate(entry.pubDate ?? entry.published ?? entry.date ?? entry.updated ?? entry.issued);
    // `content:encoded` is the full article and `description` is usually the
    // teaser, so the teaser is preferred and the article is the fallback: this
    // is a summary field and truncating an article into one produces half a
    // sentence where a publisher had already written a whole one.
    const summary = plainText(entry.description ?? entry.summary ?? entry.encoded ?? entry.content);
    const author = readAuthor(entry.author ?? entry.creator);
    const categories = readCategories(entry.category);

    const item: FeedItem = { id: readId(entry, title, publishedAt, url), title };

    if (summary !== undefined) item.summary = summary;
    if (url !== undefined) item.url = url;
    if (publishedAt !== undefined) item.publishedAt = publishedAt;
    if (author !== undefined) item.author = author;
    if (categories.length > 0) item.categories = categories;

    return item;
}

/** See {@link FeedItem.id} for why the ladder is in this order and why it ends in a hash. */
function readId(entry: Record<string, unknown>, title: string, publishedAt: string | undefined, url: string | undefined): string {
    return text(entry.guid) ?? text(entry.id) ?? url ?? `hash:${hash(`${title}\u0000${publishedAt ?? ''}`)}`;
}

/**
 * A link, from either of the two places a feed puts one.
 *
 * RSS writes the URL as the element's text; Atom writes it as an `href`
 * attribute and may write several, distinguished by `rel`. `alternate` (or an
 * absent `rel`, which means `alternate`) is the human-readable page, which is
 * the only one anything here wants — `self` is the feed itself and `enclosure`
 * is an attachment, and returning either would have a reader link a listener
 * back to the XML.
 */
function readLink(value: unknown): string | undefined {
    const candidates = asArray(value);

    for (const candidate of candidates) {
        if (typeof candidate === 'string') return trimmed(candidate);
        if (!isRecord(candidate)) continue;

        const rel = text(candidate['@_rel']);
        if (rel !== undefined && rel !== 'alternate') continue;

        const href = text(candidate['@_href']) ?? text(candidate['#text']);
        if (href !== undefined) return href;
    }

    return undefined;
}

/**
 * A date as ISO-8601, or nothing.
 *
 * `Date` parses RFC-822 (RSS) and ISO-8601 (Atom) alike, which is the whole
 * reason this is three lines rather than a format table. Anything it cannot
 * read answers `undefined` rather than a guess or an epoch: "when this was
 * published is unknown" is a fact a reader can act on, and 1970 is not.
 */
function readDate(value: unknown): string | undefined {
    const raw = text(value);
    if (raw === undefined) return undefined;

    const at = new Date(raw);
    return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** RSS writes a name or an address; Atom nests a `name` inside an `author` element. */
function readAuthor(value: unknown): string | undefined {
    const first = asArray(value)[0];
    if (typeof first === 'string') return trimmed(first);
    if (!isRecord(first)) return undefined;

    return text(first.name) ?? text(first['#text']);
}

/** RSS writes a category as text, Atom as a `term` attribute. Deduplicated, order kept. */
function readCategories(value: unknown): string[] {
    const seen = new Set<string>();

    for (const candidate of asArray(value)) {
        const name =
            typeof candidate === 'string'
                ? trimmed(candidate)
                : isRecord(candidate)
                  ? (text(candidate['@_term']) ?? text(candidate['#text']))
                  : undefined;
        if (name !== undefined) seen.add(name);
    }

    return [...seen];
}

/**
 * An element's markup as something a person could be read aloud.
 *
 * The stripping, decoding and capping are `html.text.ts`'s, shared with the
 * article reader; what is left here is reaching the element's text first, which
 * is this file's own problem. See that file for why the decode runs after the
 * strip and not before.
 */
function plainText(value: unknown): string | undefined {
    const raw = text(value);
    return raw === undefined ? undefined : asPlainText(raw, FEED_SUMMARY_MAX_CHARS);
}

/**
 * FNV-1a, as hex.
 *
 * Not a cryptographic hash and not asked to be one: it identifies an entry
 * within one feed, where a collision costs one repeated headline. Written out
 * rather than taken from `node:crypto` so this file stays a pure string
 * function with no platform import, which is what lets a plugin call it from
 * anywhere.
 */
function hash(value: string): string {
    let accumulated = 0x811c9dc5;

    for (let at = 0; at < value.length; at += 1) {
        accumulated ^= value.charCodeAt(at);
        accumulated = Math.imul(accumulated, 0x01000193);
    }

    return (accumulated >>> 0).toString(16).padStart(8, '0');
}

/** A repeated element arrives as an array and a single one does not. This is that, flattened. */
function asArray(value: unknown): unknown[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown): Record<string, unknown> | undefined => (isRecord(value) ? value : undefined);

const trimmed = (value: string): string | undefined => (value.trim().length === 0 ? undefined : value.trim());

/**
 * An element's text, wherever the parser put it.
 *
 * A field is a bare string until it carries an attribute, at which point it
 * becomes `{ '#text': …, '@_type': … }`. Reading only the first shape is the
 * single easiest way to lose a title, because `type="html"` on one is entirely
 * ordinary.
 */
function text(value: unknown): string | undefined {
    if (typeof value === 'string') return trimmed(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (isRecord(value)) return text(value['#text']);

    return undefined;
}
