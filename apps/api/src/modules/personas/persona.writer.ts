/**
 * A description in an operator's words, as a whole persona.
 *
 * Pure — a description and a model's answer in, a draft out — so the parse and the checks below are
 * testable without a model, exactly like `break.prompt.ts` and `set.prompt.ts` are.
 *
 * ## Why this exists at all, when a sheet is the point
 *
 * The sheet is what makes a character CHECKABLE: `characterFault` reads a model's answer back
 * against the markers, the samples, the signatures and the forbidden wording, and none of that is
 * possible against a paragraph of prose. That is the whole design and nothing here touches it.
 *
 * What it costs is authoring. A sheet is eight fields, and `dictionMarkers` in particular has to be
 * words this character would actually say — get that wrong and every break declines, which looks
 * exactly like a model that is switched off. So the station ships ten seeds and has no practical way
 * to make an eleventh. This is that way: the boxes are filled in by something that has just invented
 * the character and therefore knows which words are its own.
 *
 * ## The self-check is the part worth having, and it is the sheet's own machinery
 *
 * A generated sheet's characteristic failure is a marker list that no line of the character would
 * ever contain — a model asked for "words that prove the dialect" reaches for the most distinctive
 * ones rather than the most frequent, and hands back six words it will never use again. Nothing
 * about that is visible until every break declines.
 *
 * So the answer is judged against itself before it is offered: the sheet's own sample lines are run
 * through {@link dictionMarkersIn}, and a marker that none of them carries is DROPPED. The samples
 * are the evidence and the marker list is the claim, so where they disagree the claim is what gives
 * way. {@link keepsCharacter} already treats a sheet with no markers as one that made no checkable
 * claim, which is why dropping them all is a safe floor and refusing the persona would not be.
 *
 * The same posture covers the phrasings: a template naming a placeholder the vocabulary does not
 * have is dropped BY THE LINE, because five good phrasings and one broken one is five phrasings.
 */

import { TEMPLATE_VOCABULARY, unknownPlaceholders } from '#modules/director/break.templates.js';
import { jsonObjects, withoutThinking } from '#modules/shared/json.objects.js';
import type { LlmMessage } from '@deadair/plugin-sdk';
import type { PersonaDraft } from './persona.js';
import { dictionMarkersIn, PERSONA_SHEET_LIMITS } from './persona.sheet.js';

/** How long a description may be. Long enough for a paragraph, short enough not to be a script. */
export const MAX_DESCRIPTION = 2000;

/**
 * Which model writes a persona.
 *
 * A key of its own beside `llm.breakModel` and `llm.setModel`, on the argument the other two are
 * already made with: the model is a per-call parameter because one station cannot install a plugin
 * twice, and these three jobs are worth sizing differently. This is the one where the big model is
 * obviously right — it runs when an operator presses a button, once, and what it produces is edited
 * afterwards rather than aired.
 *
 * There is no `enabled` beside it, and that is deliberate rather than an omission. The other two
 * gate an AUTONOMOUS behaviour the station performs on its own; this only ever runs because somebody
 * asked, which is the same carve-out that exempts a manual trigger from the frequency gate. A switch
 * here would turn off a button rather than a behaviour.
 */
export const PERSONA_MODEL_KEY = 'llm.personaModel';

/** How long an operator will wait for the gate before being told the station is busy. */
export const MAX_WAIT_MS = 60_000;

/**
 * The whole budget for writing one persona.
 *
 * Generous next to a break's, because nothing is waiting on it: a break has a slot and this has an
 * operator who pressed a button and can see that it is working. Bounded all the same, since it holds
 * the one model slot while it runs and a refill behind it is doing real work.
 */
export const BUDGET_MS = 240_000;

/**
 * The ceiling on the answer.
 *
 * Higher than a break's by a lot: this is eight fields, several of them lists, and the observed
 * failure of the picks reader is that a truncated answer costs the last thing in it. Here that would
 * be the phrasings, which are the part an operator would least like to write by hand.
 */
export const MAX_OUTPUT_TOKENS = 4000;

/**
 * Placeholders that belong to one KIND of break rather than to any of them.
 *
 * A persona's phrasings are the floor under an ordinary talk break, and a break between two records
 * has no business reading a headline or saying good evening — the shapes that own those values
 * supply them. Named as an exclusion rather than by listing what IS offered, so `{{next.album}}`
 * reaches an operator's generated persona on the day enrichment adds it.
 */
const KIND_SPECIFIC_VALUES = new Set(['news.headlines', 'greeting']);

/**
 * The vocabulary a phrasing may use, named in the prompt.
 *
 * Sent rather than left to be guessed, for the reason the markers are sent to a break writer: a
 * model marked against a list it was never shown is being graded on a rubric it cannot read. Every
 * line it writes against a placeholder that does not exist is a line this file then throws away, so
 * not naming them would mean paying for phrasings and discarding most of them.
 *
 * Derived from `break.templates.ts` rather than copied, because a copy is a second place the
 * vocabulary is written and the whole point of that map being explicit is that adding to it is one
 * row.
 */
const TEMPLATE_VALUES = TEMPLATE_VOCABULARY.filter(value => !KIND_SPECIFIC_VALUES.has(value)).map(value => `{{${value}}}`);

/**
 * What the model is asked for.
 *
 * The shape is stated as a JSON example rather than as a schema because there is no structured-output
 * path here — `LlmService` is a transport for a conversation and nothing more — and because a local
 * model follows an example far more reliably than it follows a description of one.
 *
 * The instructions that matter are the ones about the two fields nothing else can repair. `samples`
 * has to be the character actually talking, since it is both the few-shot the break writer sees and
 * the evidence this file checks the markers against. And `dictionMarkers` has to be words the
 * character uses OFTEN rather than words that are unusual — which is the one instruction a model
 * gets wrong by trying to be helpful, and the one the check below exists to catch.
 */
export function personaPrompt(description: string): LlmMessage[] {
    return [
        {
            role: 'system',
            content: [
                'You invent presenters for a radio station. Given a description, write one coherent character: who they are, how they speak, and what they play.',
                '',
                'Answer with one JSON object and nothing else, in this shape:',
                '{',
                '  "key": "a short lowercase slug, letters only",',
                '  "label": "what the console calls this character, a few words",',
                '  "style": "completes the sentence \\"You are …\\". A presenter, not a different job. One clause.",',
                '  "djName": "the name they go by on air, or omit it if they are a manner rather than a character",',
                '  "diction": ["how they speak, as rules that apply to EVERY sentence: grammar, contractions, word substitutions"],',
                '  "dictionMarkers": ["single words this character says OFTEN"],',
                '  "quirks": ["what they always and never do on air, and what they care about"],',
                '  "catchphrases": ["signature phrases, at most three"],',
                '  "avoid": ["wording that would break the character"],',
                '  "background": "a couple of grounded facts they may mention about themselves",',
                '  "samples": ["lines in their own voice, as they would actually be said on air"],',
                '  "music": "what this character plays, in a sentence",',
                `  "templates": "plain phrasings in this character's voice, one per line, using only these values: ${TEMPLATE_VALUES.join(' ')}"`,
                '}',
                '',
                'Rules:',
                // The instruction the whole self-check exists because models get wrong. A model asked
                // for distinctive words hands back its six most unusual ones and then never uses them.
                '- dictionMarkers are FREQUENCY, not novelty. Every one of them must appear in the sample lines you write. A word the character would say once a month is not a marker.',
                '- The samples are the character talking on air between two records. They must obey the diction rules exactly, because everything else is checked against them.',
                '- A phrasing in "templates" is what the station says when nothing else wrote the break, so it must read as a complete sentence with the values filled in. Wrap a part that can be left out in [[double brackets]].',
                '- diction is HOW they talk and quirks are WHAT they talk about. Do not put a subject in diction.',
                '- No stage directions, no asterisks, no emoji anywhere.',
            ].join('\n'),
        },
        { role: 'user', content: `Write a presenter from this description:\n\n${description.trim().slice(0, MAX_DESCRIPTION)}` },
    ];
}

/** What the generator answers with, and what it had to change to make it usable. */
export interface GeneratedPersona {
    draft: PersonaDraft;
    /**
     * Markers the model named and its own sample lines never used.
     *
     * Reported rather than merely dropped, because it is the one thing about a generated sheet an
     * operator would otherwise have to discover by putting it on air.
     */
    droppedMarkers: string[];
    /** Phrasings that named a value the vocabulary does not have. */
    droppedTemplates: string[];
}

/**
 * A model's answer as a persona, or `undefined` when there is no usable object in it.
 *
 * Forgiving about SHAPE and unforgiving about CONTENT, which is `readPicks`'s posture and is right
 * here for the same reason: a parse failure costs an operator one click, so there is nothing to be
 * gained by refusing an answer that wrapped its JSON in a sentence. But a field of the wrong type is
 * dropped rather than coerced, because a persona is edited by hand immediately afterwards and a
 * half-repaired field is worse to correct than an empty one.
 *
 * The three fields the database requires — `key`, `label`, `style` — are the only ones whose absence
 * makes the whole answer unusable. Everything else is optional on a real persona too.
 */
export function readPersona(text: string): GeneratedPersona | undefined {
    const spans = jsonObjects(withoutThinking(text));

    for (const span of spans) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(span);
        } catch {
            // One malformed object costs itself and nothing after it — the same reason the picks
            // reader parses them separately.
            continue;
        }
        if (typeof parsed !== 'object' || parsed === null) continue;

        const generated = draftFrom(parsed as Record<string, unknown>);
        if (generated !== undefined) return generated;
    }

    return undefined;
}

function draftFrom(raw: Record<string, unknown>): GeneratedPersona | undefined {
    const key = slug(raw.key);
    const label = text(raw.label);
    const style = text(raw.style);
    if (key === undefined || label === undefined || style === undefined) return undefined;

    const samples = list(raw.samples, PERSONA_SHEET_LIMITS.samples);
    const named = list(raw.dictionMarkers, PERSONA_SHEET_LIMITS.dictionMarkers);
    // Judged against the character's own lines, which is the one check nothing downstream can make:
    // by the time a break declines for missing diction, the sheet has been on air for an evening.
    const markers = named.filter(marker => samples.some(sample => dictionMarkersIn([marker], sample).length > 0));

    const phrasings = lines(raw.templates);
    const templates = phrasings.filter(line => unknownPlaceholders(line).length === 0);

    return {
        draft: {
            key,
            label,
            style,
            ...omitUndefined({
                djName: text(raw.djName),
                background: text(raw.background),
                music: text(raw.music),
                // Empty means the station's own phrasings, which is a legitimate persona and the
                // right answer for one whose every generated line was malformed.
                templates: templates.length === 0 ? undefined : templates.join('\n'),
                diction: nonEmpty(list(raw.diction, PERSONA_SHEET_LIMITS.diction)),
                dictionMarkers: nonEmpty(markers),
                quirks: nonEmpty(list(raw.quirks, PERSONA_SHEET_LIMITS.quirks)),
                catchphrases: nonEmpty(list(raw.catchphrases, PERSONA_SHEET_LIMITS.catchphrases)),
                avoid: nonEmpty(list(raw.avoid, PERSONA_SHEET_LIMITS.avoid)),
                samples: nonEmpty(samples),
            }),
        },
        droppedMarkers: named.filter(marker => !markers.includes(marker)),
        droppedTemplates: phrasings.filter(line => !templates.includes(line)),
    };
}

/** A slug the personas table will accept, or `undefined`. Letters only, which is what the seeds use. */
function slug(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const cleaned = value.trim().toLowerCase().replace(/[^a-z]/g, '');
    return cleaned.length === 0 ? undefined : cleaned.slice(0, 32);
}

function text(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
}

/** The strings in an array, capped. A non-array, or an entry that is not a string, contributes nothing. */
function list(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    for (const entry of value) {
        const cleaned = text(entry);
        if (cleaned !== undefined) seen.add(cleaned);
    }
    return [...seen].slice(0, limit);
}

/** The phrasings in a `templates` value, which a model may answer as a string or as an array. */
function lines(value: unknown): string[] {
    const raw = Array.isArray(value) ? value.map(entry => (typeof entry === 'string' ? entry : '')).join('\n') : typeof value === 'string' ? value : '';
    return raw
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
}

const nonEmpty = (values: string[]): string[] | undefined => (values.length === 0 ? undefined : values);

function omitUndefined<T extends Record<string, unknown>>(values: T): Partial<T> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}
