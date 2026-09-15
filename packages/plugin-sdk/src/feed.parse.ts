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
 * ## A podcast is a feed with an attachment
 *
 * A podcast feed is RSS 2.0 with the iTunes namespace on top, and the part a
 * station needs from it is exactly the part a news reader throws away: the
 * `enclosure`, which is the audio, and `itunes:duration`, which is how long it
 * runs. Both are read here onto {@link FeedItem.enclosure} and
 * {@link FeedItem.durationMs}, and the channel's own description, artwork and
 * language onto {@link ParsedFeed}, because a second plugin reading a podcast
 * would otherwise write the same namespace handling again. Every one of those
 * fields is optional, so a reader that wants none of them (`plugins/rss`) reads
 * exactly what it read before.
 *
 * What an enclosure is NOT is a link. {@link FeedItem.url} is still only ever
 * the page a person reads, and the audio never arrives there: a news reader
 * that followed an enclosure as though it were the story would fetch a
 * sixty-megabyte file to look for paragraphs in it.
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
    /**
     * The file attached to this entry, which for a podcast is the episode
     * itself. See {@link FeedEnclosure}.
     *
     * Absent for an entry that attaches nothing, which is every entry of an
     * ordinary news feed, and for one whose attachment is not at an http(s)
     * address somebody could fetch.
     */
    enclosure?: FeedEnclosure;
    /**
     * How long the attachment runs, in whole milliseconds, as the PUBLISHER
     * says: `itunes:duration`, written as `HH:MM:SS`, `MM:SS` or bare seconds.
     *
     * A claim rather than a measurement, and absent where the feed made none
     * or made one this cannot read. Nothing here guesses one from the
     * enclosure's size, because a byte count divided by a bitrate nobody
     * stated is a number that looks measured and is not.
     */
    durationMs?: number;
    /** This entry's own artwork, where it has some (`itunes:image`). Always http(s). */
    imageUrl?: string;
    /**
     * Whether the publisher marked this entry explicit (`itunes:explicit`).
     *
     * Absent means the feed did not say, which is not the same as clean: a
     * reader enforcing a clean-only policy has to demand a positive `false`,
     * on `ProviderTrack.advisory`'s argument.
     */
    explicit?: boolean;
    /** `itunes:season`, a positive whole number, when the publisher numbers them. */
    season?: number;
    /** `itunes:episode`, a positive whole number, when the publisher numbers them. */
    episode?: number;
}

/**
 * A file attached to an entry: RSS 2.0's `<enclosure>` or an Atom
 * `<link rel="enclosure">`.
 *
 * Every part except the address is the publisher's claim and is passed on as
 * one. `type` in particular is whatever the publisher's CMS wrote, and
 * `audio/x-m4a`, `audio/mp3` and an empty string are all ordinary: a reader
 * deciding what it can play reads this and the address's extension together.
 */
export interface FeedEnclosure {
    /** Always http(s). An enclosure at any other address is not reported at all. */
    url: string;
    /** The declared media type, lower-cased, e.g. `audio/mpeg`. */
    type?: string;
    /**
     * The declared size in bytes. Absent when the feed wrote nothing, zero, or
     * something that is not a whole number, all three of which are common: a
     * great many feeds write `length="0"` because the element requires the
     * attribute and the publisher did not know.
     */
    lengthBytes?: number;
}

/** A feed, and what it holds. */
export interface ParsedFeed {
    title?: string;
    /** Where the publication itself lives, as opposed to any one entry. */
    homeUrl?: string;
    /** What the publication says about itself, as plain text. See {@link FEED_SUMMARY_MAX_CHARS}. */
    description?: string;
    /** Who publishes it: `itunes:author`, or an Atom feed's own `author`. */
    author?: string;
    /** The publication's artwork: `itunes:image`, or RSS 2.0's `<image><url>`. Always http(s). */
    imageUrl?: string;
    /** The language the publication declares, as written (`en`, `en-us`). */
    language?: string;
    /** The publication's own labels, including iTunes categories. Deduplicated, order kept. */
    categories?: string[];
    /** Whether the publisher marked the whole publication explicit. See {@link FeedItem.explicit}. */
    explicit?: boolean;
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

    const title = speakable(channel.title);
    if (title !== undefined) feed.title = title;

    const homeUrl = readLink(channel.link);
    if (homeUrl !== undefined) feed.homeUrl = homeUrl;

    // `itunes:summary` arrives as `summary` once the prefix is gone, and is the
    // longer of the two where a podcast carries both; `subtitle` is the last
    // resort, being a line rather than a description.
    const description = plainText(channel.description ?? channel.summary ?? channel.subtitle);
    if (description !== undefined) feed.description = description;

    const author = readAuthor(channel.author);
    if (author !== undefined) feed.author = author;

    const imageUrl = readImage(channel.image);
    if (imageUrl !== undefined) feed.imageUrl = imageUrl;

    const language = text(channel.language);
    if (language !== undefined) feed.language = language;

    const categories = readCategories(channel.category);
    if (categories.length > 0) feed.categories = categories;

    const explicit = readExplicit(channel.explicit);
    if (explicit !== undefined) feed.explicit = explicit;

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
    const title = speakable(entry.title);
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

    const enclosure = readEnclosure(entry.enclosure) ?? readEnclosure(entry.link);
    if (enclosure !== undefined) item.enclosure = enclosure;

    const durationMs = readDuration(entry.duration);
    if (durationMs !== undefined) item.durationMs = durationMs;

    const imageUrl = readImage(entry.image);
    if (imageUrl !== undefined) item.imageUrl = imageUrl;

    const explicit = readExplicit(entry.explicit);
    if (explicit !== undefined) item.explicit = explicit;

    const season = readOrdinal(entry.season);
    if (season !== undefined) item.season = season;

    const episode = readOrdinal(entry.episode);
    if (episode !== undefined) item.episode = episode;

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

/**
 * RSS writes a category as text, Atom as a `term` attribute, and iTunes as a
 * `text` attribute with its subcategories nested inside it. Deduplicated,
 * order kept, parents before their children.
 */
function readCategories(value: unknown): string[] {
    const seen = new Set<string>();

    const visit = (candidates: unknown[]): void => {
        for (const candidate of candidates) {
            const name =
                typeof candidate === 'string'
                    ? trimmed(candidate)
                    : isRecord(candidate)
                      ? (text(candidate['@_term']) ?? text(candidate['@_text']) ?? text(candidate['#text']))
                      : undefined;
            if (name !== undefined) seen.add(name);
            if (isRecord(candidate)) visit(asArray(candidate.category));
        }
    };

    visit(asArray(value));
    return [...seen];
}

/**
 * The first attachment that is at a fetchable address, from either place a
 * feed writes one.
 *
 * RSS 2.0 permits one `<enclosure>` per item and a good number of feeds write
 * several anyway; Atom writes any number of `<link rel="enclosure">` beside the
 * page link. Both arrive as a list here, and an AUDIO attachment is preferred
 * over whatever came first, because a podcast that also attaches its cover as
 * a second enclosure is ordinary and the cover is not the episode.
 *
 * Read off `link` as well as `enclosure`, and only ever the entries whose
 * `rel` says enclosure: an Atom link with no `rel` is the page, which
 * `readLink` answers and this must not.
 */
function readEnclosure(value: unknown): FeedEnclosure | undefined {
    const found: FeedEnclosure[] = [];

    for (const candidate of asArray(value)) {
        if (!isRecord(candidate)) continue;

        // An RSS `<enclosure>` has no `rel`; an Atom link has to say it is one.
        const rel = text(candidate['@_rel']);
        const isAtomLink = candidate['@_href'] !== undefined;
        if (isAtomLink && rel !== 'enclosure') continue;

        const url = webAddress(text(candidate['@_url']) ?? text(candidate['@_href']));
        if (url === undefined) continue;

        const enclosure: FeedEnclosure = { url };
        const type = text(candidate['@_type'])?.toLowerCase();
        if (type !== undefined) enclosure.type = type;
        const lengthBytes = positiveWhole(text(candidate['@_length']));
        if (lengthBytes !== undefined) enclosure.lengthBytes = lengthBytes;

        found.push(enclosure);
    }

    return found.find(enclosure => enclosure.type?.startsWith('audio/') === true) ?? found[0];
}

/**
 * `itunes:duration` as whole milliseconds, or nothing.
 *
 * Three spellings are in the wild and all three are read: `HH:MM:SS`, `MM:SS`,
 * and bare seconds, any of them with a fraction on the last part. Anything
 * else — `1h 2m`, `about an hour`, an empty element — answers `undefined`
 * rather than a guess, on {@link readDate}'s argument: an unknown length is a
 * fact a reader can act on and a wrong one is not.
 *
 * A duration of zero is absent too. Publishers write `0` and `00:00:00` when
 * their CMS did not know, and a zero-length episode is not a thing anything
 * should plan around.
 */
function readDuration(value: unknown): number | undefined {
    const raw = text(asArray(value)[0]);
    if (raw === undefined) return undefined;

    const parts = raw.split(':').map(part => part.trim());
    if (parts.length > 3) return undefined;
    if (!parts.every((part, at) => (at === parts.length - 1 ? /^\d+(\.\d+)?$/ : /^\d+$/).test(part))) return undefined;

    // Only the LEADING unit may run past 59: `90:00` is an ordinary way to write an hour and a
    // half, where `1:90:00` and `12:75` are typos, and reading either would be a guess.
    if (parts.slice(1).some(part => Number(part) >= 60)) return undefined;

    const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
    const ms = Math.round(seconds * 1_000);
    return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/**
 * Artwork, from either of the two shapes a feed writes it in.
 *
 * `itunes:image` is an `href` attribute; RSS 2.0's own `<image>` nests a
 * `<url>`. A podcast channel commonly carries both, which arrive together as
 * a list once the prefix is gone, and the iTunes one is preferred: it is the
 * square the directories show, where RSS's is a small banner.
 */
function readImage(value: unknown): string | undefined {
    const candidates = asArray(value);

    for (const candidate of candidates) {
        if (isRecord(candidate)) {
            const href = webAddress(text(candidate['@_href']));
            if (href !== undefined) return href;
        }
    }

    for (const candidate of candidates) {
        const url = isRecord(candidate) ? webAddress(text(candidate.url)) : webAddress(text(candidate));
        if (url !== undefined) return url;
    }

    return undefined;
}

/**
 * `itunes:explicit`, which has been spelled four ways across the spec's
 * history. Anything else is absent rather than either answer.
 */
function readExplicit(value: unknown): boolean | undefined {
    const raw = text(asArray(value)[0])?.toLowerCase();
    if (raw === 'yes' || raw === 'true' || raw === 'explicit') return true;
    if (raw === 'no' || raw === 'false' || raw === 'clean') return false;
    return undefined;
}

/** A season or episode number: a positive whole number, or nothing. */
const readOrdinal = (value: unknown): number | undefined => positiveWhole(text(asArray(value)[0]));

/** A positive whole number written as text, or nothing. */
function positiveWhole(raw: string | undefined): number | undefined {
    if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * An address somebody could fetch, or nothing.
 *
 * Art and audio are both handed on to be fetched by something that is not
 * this plugin, and the SDK's rule for an art URL is that it is http(s) only;
 * the same rule is applied to the audio for the same reason. `file:`,
 * `data:` and a relative path are all things a feed can contain.
 */
function webAddress(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    try {
        const { protocol } = new URL(raw);
        return protocol === 'http:' || protocol === 'https:' ? raw : undefined;
    } catch {
        return undefined;
    }
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
 *
 * And it is an ARRAY when the element is repeated, which `removeNSPrefix`
 * makes far commoner than any feed intends: a podcast writes both `<title>`
 * and `<itunes:title>`, and with the prefix gone those are two `title`s. The
 * first readable one is the answer, which is the plain RSS element wherever a
 * publisher wrote both in the usual order. Before this, every entry of such a
 * feed was dropped as having no title at all — measured on NPR's Planet Money
 * feed, 355 entries and none of them read.
 */
function text(value: unknown): string | undefined {
    if (typeof value === 'string') return trimmed(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        for (const candidate of value) {
            const found = text(candidate);
            if (found !== undefined) return found;
        }
        return undefined;
    }
    if (isRecord(value)) return text(value['#text']);

    return undefined;
}

/**
 * A TITLE, which is text a voice will say rather than a field something matches on.
 *
 * The same treatment {@link FeedItem.summary} already gets, and it has to be: the XML parser
 * decodes the document's own escaping ONCE, which is right for a title written as `AT&amp;T` and
 * not enough for one written as `it&amp;#8217;s` — an apostrophe a publisher escaped twice, which
 * is entirely ordinary in a feed whose titles came out of a CMS. What arrives here is then
 * `it&#8217;s`, and a bulletin read that out on air with the entity still in it.
 *
 * Tags come out for the same reason: `type="html"` on a title is ordinary, and a `<em>` reaching a
 * speaking voice is the failure `NewsItem.summary` documents.
 */
const speakable = (value: unknown): string | undefined => {
    const raw = text(value);
    return raw === undefined ? undefined : asPlainText(raw);
};
