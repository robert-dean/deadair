/**
 * What the station asks a model to find in an article, and what it will accept
 * back.
 *
 * Pure functions and no I/O, so the decisions here are testable without a
 * model. The binding that uses them is `fact.extraction.service.ts`.
 *
 * ## Two passes, and why the second one is not optional
 *
 * The first asks a model to read an article and pull out claims worth saying.
 * The second shows a DIFFERENT conversation only the claim and the span of text
 * meant to support it, and asks whether the text really says that. Unsupported
 * claims are dropped without comment.
 *
 * The second pass is cheap and it is the whole defence. A model reading a
 * Soundgarden article will produce "Rusty Cage appeared in Ace Ventura" with
 * complete confidence whether or not the article mentions a film, because the
 * shape of the sentence is what it was asked for. What it cannot do is produce
 * a verbatim span that supports a claim the article never made — so the
 * verifier is not asked to know anything about music, only whether one piece of
 * text entails another, which is the one thing a small local model is reliable
 * at.
 *
 * ## What is banned, and why the ban is on the SHAPE
 *
 * The same failure `break.prompt.ts` is built around, one step earlier. A model
 * asked for trivia will pad: it turns "the album was recorded in Seattle" into
 * "the band recorded in Seattle, as many grunge acts did", and the addition is
 * both plausible and unsourced. So the instruction is to copy rather than to
 * summarise, and the verifier enforces it by comparing against a quote that has
 * to exist.
 */

import type { LlmMessage } from '@deadair/plugin-sdk';
import { FACT_CATEGORIES, type FactCategory } from './fact.repository.js';

/** How many claims one article is asked for. */
export const MAX_MODEL_CLAIMS = 5;

/**
 * How much of an article the model is shown.
 *
 * An article's own length is not the bound that matters: the bound is the
 * model's context, and the local one this was written against spills its VRAM
 * well before a long article ends and drops to a couple of tokens a second when
 * it does. The lead plus the first few sections is where the placements and the
 * recording stories are anyway; discographies and chart tables are at the
 * bottom and yield nothing worth saying.
 */
export const MAX_ARTICLE_CHARS = 8_000;

/** What a subject is called in the instruction, so the model knows what it is reading about. */
export interface ExtractionSubject {
    kind: 'song' | 'record' | 'artist';
    name: string;
    /** The artist, for a song or a record. Absent when the subject IS the artist. */
    artist?: string;
}

/** One claim as the model is asked to state it. */
export interface ModelClaim {
    claim: string;
    quote: string;
    category: FactCategory;
}

const CATEGORY_HELP: Record<FactCategory, string> = {
    summary: 'what the record or artist basically is',
    placement: 'used in a film, a television programme, an advert or a game',
    chart: 'how it performed, sold or was certified',
    recording: 'how or where it was made, and by whom it was produced',
    personnel: 'who played on it, wrote it or guested',
    controversy: 'a ban, a lawsuit, a feud, a scandal',
    cover_or_sample: 'covered by, a cover of, sampled by, samples',
    ending: 'a death, a split, a final performance',
};

/**
 * The article, cut to what a model will read attentively.
 *
 * Cut at a paragraph boundary rather than mid-sentence, because the model is
 * about to be asked to quote from this verbatim and a half sentence at the end
 * is a quote it can copy that will never be found in the real article.
 */
export function readable(text: string, limit = MAX_ARTICLE_CHARS): string {
    if (text.length <= limit) return text;

    const cut = text.slice(0, limit);
    const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));

    return (lastBreak > limit / 2 ? cut.slice(0, lastBreak + 1) : cut).trim();
}

/** How the subject is described to the model in one line. */
export function describeSubject(subject: ExtractionSubject): string {
    if (subject.kind === 'artist') return `the artist ${subject.name}`;
    return subject.artist ? `the ${subject.kind} "${subject.name}" by ${subject.artist}` : `the ${subject.kind} "${subject.name}"`;
}

/**
 * The extraction turn.
 *
 * The rules are all about not writing anything. A model asked for interesting
 * facts writes interesting sentences; a model asked to copy sentences that are
 * already there copies them, and the ones it invents anyway are caught by the
 * pass below because their quotes do not exist.
 */
export function extractPrompt(subject: ExtractionSubject, article: string, limit = MAX_MODEL_CLAIMS): LlmMessage[] {
    const categories = FACT_CATEGORIES.filter(category => category !== 'summary')
        .map(category => `- ${category}: ${CATEGORY_HELP[category]}`)
        .join('\n');

    return [
        {
            role: 'system',
            content: [
                'You pull short, checkable facts out of encyclopaedia articles for a radio station to mention on air.',
                '',
                'Rules:',
                '- Every fact must be stated by the article. Never add anything you know from elsewhere, however sure you are.',
                '- Quote the exact words from the article that state it. Copy them character for character. Do not paraphrase the quote.',
                '- Write the fact as one plain sentence a presenter could say out loud, under 40 words.',
                '- Prefer the specific and the surprising: a film it was used in, who played on it, what it was banned for.',
                '- Skip anything about how the article was written, its references, or its own sections.',
                '- Skip what the record simply IS. That is already known.',
                '- If the article states nothing worth saying, answer with an empty list. That is a normal answer.',
                '',
                'Categories:',
                categories,
                '',
                'Answer with JSON only, in this shape:',
                '{"facts":[{"claim":"...","quote":"...","category":"..."}]}',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [`This article is about ${describeSubject(subject)}.`, `Give at most ${limit} facts.`, '', readable(article)].join('\n'),
        },
    ];
}

/**
 * The verification turn.
 *
 * Deliberately knows nothing about music, radio, or which record this is. It is
 * shown one claim and one span of text and asked whether the second states the
 * first — a narrow question a small model answers well, where "is this a good
 * fact about Soundgarden" is one it answers agreeably.
 *
 * The instruction to default to `no` is load-bearing. A model asked to judge
 * its own earlier output agrees with itself; the tie has to be broken towards
 * dropping the claim, because a dropped fact costs a sentence and a kept false
 * one costs the station's credibility on air.
 */
export function verifyPrompt(claim: string, quote: string): LlmMessage[] {
    return [
        {
            role: 'system',
            content: [
                'You check whether a piece of text states a claim.',
                '',
                'Answer "yes" only if the text says the claim outright. Answer "no" if it only implies it, if it is about something',
                'similar, if it needs any outside knowledge, or if you are unsure. When it is close, answer "no".',
                '',
                'Answer with one word: yes or no.',
            ].join('\n'),
        },
        { role: 'user', content: [`Text: ${quote}`, '', `Claim: ${claim}`].join('\n') },
    ];
}

/** Whether the verifier said yes. Anything else, including nothing, is a no. */
export function verified(answer: string): boolean {
    return /^\s*(?:"|')?\s*yes\b/i.test(answer);
}

/**
 * The claims out of a model's answer, with everything unusable dropped.
 *
 * Tolerant of the wrapping and strict about the content. A local model fences
 * its JSON, prefaces it, or emits its reasoning first, and none of that is a
 * reason to lose the answer — while a claim with no quote, or a quote that does
 * not occur in the article, is not a near miss to be repaired. It is the
 * failure this whole file exists to catch.
 */
export function readClaims(answer: string, article: string, limit = MAX_MODEL_CLAIMS): ModelClaim[] {
    const parsed = parseAnswer(answer);
    if (parsed === undefined) return [];

    const claims: ModelClaim[] = [];
    const seen = new Set<string>();

    for (const entry of parsed) {
        const claim = text(entry.claim);
        const quote = text(entry.quote);
        if (claim === undefined || quote === undefined) continue;

        // The quote has to be IN the article. This is what makes the row's own
        // rule — that a claim carries the span supporting it — true rather than
        // aspirational, and it is the cheapest lie detector available: a model
        // that invented the fact almost always invents the quote with it.
        if (!occurs(quote, article)) continue;

        const marker = claim.toLowerCase();
        if (seen.has(marker)) continue;
        seen.add(marker);

        claims.push({ claim, quote, category: category(entry.category) });
        if (claims.length >= limit) break;
    }

    return claims;
}

/** A model's JSON, however it wrapped it. */
function parseAnswer(answer: string): { claim?: unknown; quote?: unknown; category?: unknown }[] | undefined {
    const start = answer.indexOf('{');
    const end = answer.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;

    try {
        const parsed = JSON.parse(answer.slice(start, end + 1)) as { facts?: unknown };
        return Array.isArray(parsed.facts) ? (parsed.facts as { claim?: unknown }[]) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Whether a quote occurs in the article, allowing for whitespace and for the
 * quotation marks a model normalises on the way past.
 *
 * Not an exact substring test, because a model copying faithfully still
 * straightens a curly apostrophe and collapses a line break, and refusing those
 * would throw away most of the true claims along with the false ones. Anything
 * beyond that — a word changed, a clause dropped — is a paraphrase and fails,
 * which is the point.
 */
export function occurs(quote: string, article: string): boolean {
    const flatten = (value: string): string =>
        value.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

    const needle = flatten(quote);
    return needle.length > 0 && flatten(article).includes(needle);
}

const text = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

/** A category the store will accept. Anything else the model made up becomes `summary`. */
const category = (value: unknown): FactCategory => {
    const named = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return (FACT_CATEGORIES as readonly string[]).includes(named) ? (named as FactCategory) : 'summary';
};
