import { PluginError } from './plugin.error.js';
import { pluginCodeForStatus, retryAfterMs, upstreamDetail } from './plugin.http.js';
import { plainText, truncateSentences } from './html.text.js';
import type { HostFetchInit, PluginHost } from './plugin.host.js';

/**
 * The story behind a headline, as the paragraphs somebody else published.
 *
 * The sibling of `feed.parse.ts`, here for the same reason and with the same
 * split. A feed is a summary of a publication and frequently not a summary of
 * anything else: measured against the station's own configured feed, every
 * item's `description` was one sentence restating its title and its
 * `content:encoded` was that same sentence wrapped in a `<p>`. So a station
 * that wants to say what HAPPENED has to read the page the entry points at,
 * and every plugin that reads a feed will want this the moment it wants more
 * than titles.
 *
 * ## It extracts and it does not summarise
 *
 * Everything that comes out of here is the publisher's own prose, in the
 * publisher's own order, with the furniture removed. Nothing is rewritten,
 * nothing is joined, and no sentence is composed. That is the same boundary
 * `plugins/wikipedia` keeps by handing the host an article verbatim: only the
 * host can check a claim against the text it came from, and prose that has been
 * through a plugin's own paraphrase is prose nothing can check.
 *
 * ## Wrong in one direction on purpose
 *
 * A page that cannot be read answers `undefined` rather than a guess. Every
 * caller's fallback is the entry's own words, which is a real answer, whereas
 * navigation copy and cookie banners scraped off a template are noise a voice
 * would read out as news. So the extraction is deliberately conservative: a
 * block that is not clearly a paragraph of prose is dropped, and a page that
 * yields nothing is a page with nothing on it as far as anything here is
 * concerned.
 */

/**
 * How much of an article is kept.
 *
 * Sized to what a bulletin can use rather than to the article: the destination
 * is a model's context beside a persona sheet and a set of content rules, and a
 * writer that only ever reads out one sentence per story does not need three
 * thousand words to find it. Cut on a sentence boundary
 * ({@link truncateSentences}), because half a sentence is something a model
 * finishes out of its own head.
 */
export const ARTICLE_MAX_CHARS = 2_000;

/**
 * Shortest a block of text may be and still be taken for a paragraph of prose.
 *
 * The whole filter, and it does most of the work. A page's non-prose blocks are
 * short and its prose is not: bylines, timestamps, share prompts, tags, "hide
 * caption", and the cookie line are all under this, and a sentence of reporting
 * is comfortably over it. Every alternative worth having (a readability score, a
 * text-to-link-density ratio) is a bigger thing to be wrong in ways that are
 * harder to see.
 */
const MIN_PARAGRAPH_CHARS = 60;

/** Everything whose text is never the story, taken out with its contents. */
const FURNITURE = /<(script|style|noscript|template|svg|figure|figcaption|aside|nav|header|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * The same thing again, for publishers who mark furniture with a CLASS rather
 * than with an element.
 *
 * Not optional polish. Measured on a real wire story: the photo caption and its
 * credit sit in `<div class="credit-caption">…<p>…</p>`, which is an ordinary
 * paragraph by every structural test, and the station read "A view of the rising
 * water levels at the Wainaku Street Bridge in Hilo, Saturday, Aug. 15" out loud
 * as its first item of news.
 *
 * A heuristic over somebody else's markup, and it is allowed to be one because
 * it can only ever cut: the vocabulary is small, every word in it names
 * something that is furniture on any site that uses the word at all, and a false
 * positive costs one paragraph out of a story that has others. Non-greedy to the
 * first matching close tag, which on nested markup ends EARLY — that is the safe
 * direction, since the text being removed is in the innermost element.
 */
const FURNITURE_CLASSES =
    /<(div|section|span|p|ul|ol)\b[^>]*(?:class|id|aria-label)="[^"]*\b(caption|credit|byline|promo|newsletter|related|recirc|sidebar|share|social|advert|subscribe|paywall|tags?)\b[^"]*"[^>]*>[\s\S]*?<\/\1>/gi;

/** The containers a publisher marks the story with, in the order they are worth trusting. */
const CONTAINERS = [/<article\b[^>]*>([\s\S]*?)<\/article>/i, /<main\b[^>]*>([\s\S]*?)<\/main>/i];

/** A paragraph, which is the only block this reads. See {@link MIN_PARAGRAPH_CHARS}. */
const PARAGRAPH = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

/**
 * An article page as plain text, or `undefined` when it does not carry one.
 *
 * Pure, and that is what makes it testable against saved pages with no host in
 * the way — `parseFeed`'s split, for `parseFeed`'s reason.
 *
 * @param html - The page, as served.
 * @param maxChars - Where to cut. See {@link ARTICLE_MAX_CHARS}.
 */
export function extractArticle(html: string, maxChars: number = ARTICLE_MAX_CHARS): string | undefined {
    // Furniture first, and before the container is picked: a `<figure>` inside
    // the article is exactly the case this is for, and its caption is a full
    // sentence that would otherwise pass every test below.
    const cleaned = html.replace(FURNITURE, ' ').replace(FURNITURE_CLASSES, ' ');

    // A publisher that marked the story is trusted about where it is. One that
    // did not gets the whole document, which is safe only because the paragraph
    // filter is what actually decides — a template's own blocks do not survive
    // it.
    const body = CONTAINERS.map(pattern => pattern.exec(cleaned)?.[1]).find(found => found !== undefined) ?? cleaned;

    const paragraphs: string[] = [];
    for (const match of body.matchAll(PARAGRAPH)) {
        const text = plainText(match[1] ?? '');
        if (text === undefined || text.length < MIN_PARAGRAPH_CHARS) continue;

        // A page that repeats its own standfirst inside the body is ordinary,
        // and reading it twice is not.
        if (!paragraphs.includes(text)) paragraphs.push(text);
    }

    if (paragraphs.length === 0) return undefined;
    return truncateSentences(paragraphs.join(' '), maxChars);
}

/**
 * An article off the network, as plain text.
 *
 * Everything about the request except the status check is `host.fetch`'s, and
 * the status ladder is `plugin.http.ts`'s unmodified: `fetchFeed`'s shape, for
 * `fetchFeed`'s reasons.
 *
 * The one thing this adds is the content-type check, which is not fussiness. An
 * entry legitimately links to a PDF, an audio file or a video page, and a
 * megabyte of binary put through a tag stripper produces a long string of
 * plausible-looking rubbish rather than an error — which a bulletin would then
 * read out.
 */
export async function fetchArticle(host: PluginHost, url: string, init?: HostFetchInit): Promise<string | undefined> {
    const response = await host.fetch(url, init);

    if (!response.ok) {
        // The body is an error page nobody wants quoted, and reading it costs a
        // round trip against the same budget a retry would want.
        await response.body?.cancel();

        const error = new PluginError(`article request failed: ${upstreamDetail(response.status, response.statusText)}`).withCode(
            pluginCodeForStatus(response.status),
        );
        error.upstreamStatus = response.status;

        const advice = retryAfterMs(response.headers.get('retry-after'));
        if (advice !== undefined) error.withRetry(advice);

        throw error;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!/\b(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
        await response.body?.cancel();
        return undefined;
    }

    return extractArticle(await response.text());
}
