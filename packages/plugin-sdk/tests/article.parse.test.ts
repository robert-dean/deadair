import { describe, expect, it, vi } from 'vitest';
import { ARTICLE_MAX_CHARS, extractArticle, fetchArticle } from '../src/article.parse.js';
import { isPluginError } from '../src/plugin.error.js';
import type { PluginHost } from '../src/plugin.host.js';

/**
 * The two shapes here are the two real pages this was written against, reduced
 * to the parts that decide the answer: a text story whose article body is the
 * story, and an audio piece whose page carries only the same sentence its feed
 * entry already had. The second is the one that matters — it is what makes
 * "read the page" degrade to "read the teaser" rather than to nonsense.
 */
const STORY_PAGE = `
<!doctype html><html><head><title>Storm</title>
<script>window.dataLayer = [{"story": "a long string of tracking payload that is easily over sixty characters"}];</script>
<style>.headline { font-size: 2rem; letter-spacing: -0.01em; color: rebeccapurple; }</style>
</head><body>
<nav><p>Skip to main content. Browse every section of this website right here.</p></nav>
<article>
  <figure>
    <img src="flood.jpg"/>
    <figcaption>A view of the rising water levels at the Wainaku Street Bridge in Hilo, Saturday.</figcaption>
    <p>Taylor Cozloff/AP hide caption</p>
  </figure>
  <p>By A Reporter</p>
  <p>The storm weakened to a tropical storm Sunday after skirting the islands without making landfall, but it wasn&rsquo;t done with the coast.</p>
  <p>Total rainfall of nearly three feet was expected on the higher windward slopes, turning rivers into torrents and threatening mudslides.</p>
  <p>More than 130,000 households were without power Sunday morning &amp; crews said restoration would take days.</p>
</article>
<footer><p>Copyright of this publication, all rights reserved, terms of service and privacy policy.</p></footer>
</body></html>`;

const AUDIO_PAGE = `
<!doctype html><html><body><main>
  <p>Millions of drivers are encountering speed cameras for the first time. Many don't like it.</p>
</main></body></html>`;

describe('extractArticle', () => {
    it('reads the story and nothing around it', () => {
        const text = extractArticle(STORY_PAGE);

        expect(text).toBe(
            'The storm weakened to a tropical storm Sunday after skirting the islands without making landfall, but it wasn’t done with the coast. ' +
                'Total rainfall of nearly three feet was expected on the higher windward slopes, turning rivers into torrents and threatening mudslides. ' +
                'More than 130,000 households were without power Sunday morning & crews said restoration would take days.',
        );
    });

    // The markup a real wire story actually uses: the caption and its credit are an ordinary
    // `<p>` inside a `<div class="credit-caption">`, which passes every structural test there is.
    // Before this was handled, the station opened its bulletin by reading a photo caption.
    it('drops a caption marked by class rather than by element', () => {
        const captioned = `<article>
            <div class="credit-caption"><div class="caption" aria-label="Image caption">
                <p>A view of the rising water levels at the Wainaku Street Bridge in Hilo, Saturday, Aug. 15, 2026.
                   <b class="credit">Taylor Cozloff/AP</b><b class="hide-caption">hide caption</b></p>
            </div></div>
            <p>The storm weakened on Sunday after skirting the islands without ever making landfall.</p>
        </article>`;

        expect(extractArticle(captioned)).toBe('The storm weakened on Sunday after skirting the islands without ever making landfall.');
    });

    it('drops a caption, a byline, the navigation and the script payload', () => {
        const text = extractArticle(STORY_PAGE) ?? '';

        expect(text).not.toContain('Wainaku');
        expect(text).not.toContain('hide caption');
        expect(text).not.toContain('By A Reporter');
        expect(text).not.toContain('Skip to main content');
        expect(text).not.toContain('tracking payload');
        expect(text).not.toContain('rights reserved');
    });

    // The page this station's own feed links to for anything with audio on it.
    it('answers with the one paragraph an audio piece carries', () => {
        expect(extractArticle(AUDIO_PAGE)).toBe("Millions of drivers are encountering speed cameras for the first time. Many don't like it.");
    });

    it('answers with nothing for a page that carries no prose', () => {
        expect(extractArticle('<html><body><div><p>Sign in</p><p>Menu</p></div></body></html>')).toBeUndefined();
        expect(extractArticle('')).toBeUndefined();
        expect(extractArticle('{"not":"html at all"}')).toBeUndefined();
    });

    it('says a repeated standfirst once', () => {
        const twice = `<article><p>${'The council voted to reopen the crossing this morning after a long debate.'}</p>
            <p>The council voted to reopen the crossing this morning after a long debate.</p></article>`;

        expect(extractArticle(twice)).toBe('The council voted to reopen the crossing this morning after a long debate.');
    });

    it('cuts on a sentence rather than mid-clause', () => {
        const sentence = 'The inquiry heard evidence from a further eleven witnesses over the course of the afternoon session. ';
        const long = `<article><p>${sentence.repeat(40)}</p></article>`;

        const text = extractArticle(long) ?? '';
        expect(text.length).toBeLessThanOrEqual(ARTICLE_MAX_CHARS);
        expect(text.endsWith('session.')).toBe(true);
        expect(text).not.toContain('…');
    });
});

/**
 * Measured, not imagined: an enrichment walk collected thirty pages off
 * Wikipedia and twenty-eight carried `[ 1 ]` markers while four carried raw
 * `{{cite web}}` templates — 2.1% of every character stored. None of it is an
 * ELEMENT, so the furniture patterns never saw it, and a citation template is
 * long enough to pass the paragraph-length filter on its own.
 *
 * It matters because of what reads these: a claim extractor that checks a quoted
 * span really occurs in the source. A span quoting `{{cite web |title=How to say`
 * passes that check, which is how markup gets read out on air.
 */
describe('extractArticle: reference apparatus', () => {
    const page = (paragraph: string): string => `<article><p>${paragraph}</p></article>`;

    it('takes out a citation template that reached the page unrendered', () => {
        const text = extractArticle(
            page(
                'David Robert Jones, known as David Bowie, {{cite web |title=How to say: Bowie |url=https://example.com/x |publisher=BBC}} was an English musician.',
            ),
        );

        expect(text).toBe('David Robert Jones, known as David Bowie, was an English musician.');
    });

    it('takes out the reference markers a renderer leaves in the prose', () => {
        const text = extractArticle(page('The album sold well [ 1 ] and was reissued twice [12] over the following decade of his career.'));

        expect(text).toBe('The album sold well and was reissued twice over the following decade of his career.');
    });

    it('takes out the editorial brackets and leaves the sentence readable', () => {
        const text = extractArticle(
            page('He recorded it in Berlin [ citation needed ] over eighteen months, and mixed the whole thing twice [ edit ].'),
        );

        expect(text).toBe('He recorded it in Berlin over eighteen months, and mixed the whole thing twice.');
    });

    it('keeps what a wikilink was pointing at, since that is the words a reader sees', () => {
        const text = extractArticle(
            page('He signed to [[RCA Records]] in 1971, having previously been with [[Mercury Records|Mercury]] for two years.'),
        );

        expect(text).toBe('He signed to RCA Records in 1971, having previously been with Mercury for two years.');
    });

    it('writes no replacement token into the prose, which a shared $1 would have', () => {
        const text = extractArticle(page('The record charted [ 1 ] in three countries and stayed there for most of the following summer.')) ?? '';

        expect(text).not.toContain('$1');
    });

    it('drops a paragraph that was only apparatus rather than counting its length as prose', () => {
        // A template on its own is comfortably over MIN_PARAGRAPH_CHARS, so
        // without stripping first it reads as a paragraph of the story.
        const text = extractArticle(
            `<article><p>{{cite web |title=Something |url=https://example.com/a |publisher=Example |access-date=1 January 2020}}</p>` +
                `<p>The band re-formed in 1998 and toured for another six years before stopping again.</p></article>`,
        );

        expect(text).toBe('The band re-formed in 1998 and toured for another six years before stopping again.');
    });

    it('leaves a bracketed word the author wrote, which is not apparatus', () => {
        const text = extractArticle(page('The review called it "their finest [sic] hour", which the band quoted on the sleeve of the reissue.'));

        expect(text).toContain('[sic]');
    });
});

/** A host whose only job here is to answer one fetch. */
const hostAnswering = (response: Response): PluginHost => ({ fetch: vi.fn(async () => response) }) as unknown as PluginHost;

describe('fetchArticle', () => {
    it('reads an html page', async () => {
        const host = hostAnswering(new Response(STORY_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } }));

        expect(await fetchArticle(host, 'https://example.com/story')).toContain('Total rainfall of nearly three feet');
    });

    // A feed entry legitimately points at a PDF or an audio file, and a tag
    // stripper run over one produces plausible-looking rubbish rather than an
    // error.
    it('answers with nothing for anything that is not a page', async () => {
        const host = hostAnswering(new Response('%PDF-1.7 binary', { headers: { 'content-type': 'application/pdf' } }));

        expect(await fetchArticle(host, 'https://example.com/report.pdf')).toBeUndefined();
    });

    it("throws with the status ladder's code for a refusal", async () => {
        const host = hostAnswering(new Response('nope', { status: 429, headers: { 'retry-after': '30' } }));

        await expect(fetchArticle(host, 'https://example.com/story')).rejects.toSatisfy(
            error => isPluginError(error) && error.code === 'rate_limited' && error.retryAfterMs === 30_000,
        );
    });
});
