/**
 * Reading a production's sources for the notes it may state as fact.
 *
 * A production handed sources and no notes is researched before anything is written: each source is
 * read in chunks, the model is asked for short claims with the words in the source that state each one,
 * and a claim is kept only when those words really are there. What survives becomes the production's
 * notes, which every later pass treats as everything the station knows (`NOTES_ARE_EVERYTHING`).
 *
 * The checking is `enrichment/fact.model.ts`'s, reused rather than rewritten: `readClaims` parses an
 * answer however a local model wrapped it and drops any claim whose quote does not occur in the text,
 * and `occurs` is the comparison it makes. That file was written for encyclopaedia articles about
 * records and the verification is not about records at all, so only the prompt is new here. The
 * reason is the one that file gives: a model that invents a fact almost always invents the quote with
 * it, so requiring the quote to exist is the cheapest lie detector there is.
 *
 * ## Bounded three ways
 *
 * By chunk size, because the model's context is the bound that matters and a local model spills its
 * memory well before a long article ends (`MAX_ARTICLE_CHARS`). By chunk count per source, because a
 * twenty-thousand-character page is three model calls at most, each one an admission the station's
 * own breaks wait behind. And by notes, per source and in total, because a beat is handed only its
 * own share and an outline asked to divide sixty notes between eight beats drops most of them anyway.
 */

import type { LlmMessage } from '@deadair/plugin-sdk';
import { MAX_ARTICLE_CHARS, readClaims } from '#modules/enrichment/fact.model.js';
import type { ProductionSource } from './production.js';

/** How many characters of a source one model call reads. `fact.model.ts`'s bound, for its reason. */
export const RESEARCH_CHUNK_CHARS = MAX_ARTICLE_CHARS;

/** How many chunks of one source are read at most. Past this, the rest of a long page goes unread. */
export const MAX_CHUNKS_PER_SOURCE = 3;

/** How many notes one chunk is asked for. */
export const NOTES_PER_CHUNK = 6;

/** How many notes one source may contribute, so a long page cannot crowd out a short one. */
export const MAX_NOTES_PER_SOURCE = 8;

/** How many notes a production may be given by research, across every source. */
export const MAX_RESEARCH_NOTES = 24;

/**
 * A source's text, cut into the chunks one model call reads.
 *
 * Cut at a paragraph or a sentence boundary where there is one in the second half of the chunk, since
 * the model is about to be asked to quote from each chunk verbatim and a sentence split across two
 * chunks is a quote that exists in neither. Never more than {@link MAX_CHUNKS_PER_SOURCE}.
 */
export function chunksOf(text: string, size = RESEARCH_CHUNK_CHARS, most = MAX_CHUNKS_PER_SOURCE): string[] {
    const chunks: string[] = [];
    let rest = text.trim();

    while (rest.length > 0 && chunks.length < most) {
        if (rest.length <= size) {
            chunks.push(rest);
            break;
        }

        const cut = rest.slice(0, size);
        const boundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
        const end = boundary > size / 2 ? boundary + 1 : size;
        chunks.push(rest.slice(0, end).trim());
        rest = rest.slice(end).trim();
    }

    return chunks.filter(chunk => chunk.length > 0);
}

/** What a research call is asked about: the programme's subject, and the source being read. */
export interface ResearchRequest {
    /** What the programme is about, in the operator's words or its title. */
    subject: string;
    source: Pick<ProductionSource, 'title' | 'url'>;
    /** The chunk being read, already cut to size. */
    text: string;
    /** How many notes to ask for. */
    limit?: number;
}

/**
 * The research turn.
 *
 * The rules are `extractPrompt`'s with the records taken out: copy, never write; a quote character for
 * character; nothing from elsewhere however sure the model is. The JSON shape is that file's too, so
 * `readClaims` reads the answer as it is, with every claim falling to its `summary` category, which
 * nothing here reads.
 */
export function researchPrompt(request: ResearchRequest): LlmMessage[] {
    const limit = request.limit ?? NOTES_PER_CHUNK;

    return [
        {
            role: 'system',
            content: [
                'You pull short, checkable facts out of a piece of writing for a radio programme to state on air.',
                '',
                'Rules:',
                '- Every fact must be stated by the text. Never add anything you know from elsewhere, however sure you are.',
                '- Quote the exact words from the text that state it. Copy them character for character. Do not paraphrase the quote.',
                '- Write the fact as one plain sentence a presenter could say out loud, under 40 words, that makes sense on its own.',
                '- Prefer what bears on the subject of the programme: names, dates, figures, places, what happened and why.',
                '- Skip anything about the text itself: its author, its publisher, its links, adverts, or requests to subscribe.',
                '- If the text states nothing worth saying about the subject, answer with an empty list. That is a normal answer.',
                '',
                'Answer with JSON only, in this shape:',
                '{"facts":[{"claim":"...","quote":"..."}]}',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                `The programme is about: ${request.subject}`,
                `This is from "${request.source.title}"${request.source.url === undefined ? '' : ` (${request.source.url})`}.`,
                `Give at most ${limit} facts.`,
                '',
                request.text,
            ].join('\n'),
        },
    ];
}

/** The notes out of one research answer: claims whose quotes are really in the chunk, and nothing else. */
export function readNotes(answer: string, chunk: string, limit = NOTES_PER_CHUNK): string[] {
    return readClaims(answer, chunk, limit).map(claim => claim.claim);
}

/**
 * Notes gathered so far, with a new batch from one source added: duplicates dropped, the per-source
 * and total bounds kept. Answers the whole list, so a caller can stop as soon as it is full.
 */
export function gather(sofar: readonly string[], fromSource: readonly string[], total = MAX_RESEARCH_NOTES): string[] {
    const seen = new Set(sofar.map(note => note.toLowerCase()));
    const kept = [...sofar];

    for (const note of fromSource) {
        if (kept.length >= total) break;
        const marker = note.toLowerCase();
        if (seen.has(marker)) continue;
        seen.add(marker);
        kept.push(note);
    }

    return kept;
}
