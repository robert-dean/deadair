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

import { hasStrayBracket, TEMPLATE_VOCABULARY, unknownPlaceholders, unwrapTemplate } from '#modules/director/break.templates.js';
import { jsonObjects, parseLooseJson, withoutThinking } from '#modules/shared/json.objects.js';
import type { LlmMessage } from '@deadair/plugin-sdk';
import type { PersonaDraft } from './persona.js';
import { dictionMarkersIn, isPersonaBrevity, isPersonaLatitude, PERSONA_SHEET_LIMITS } from './persona.sheet.js';

/** How long a description may be. Long enough for a paragraph, short enough not to be a script. */
export const MAX_DESCRIPTION = 2000;

/**
 * How many sample lines a marker may be earned from.
 *
 * Higher than `PERSONA_SHEET_LIMITS.samples`, which is what gets STORED. A model that wrote six lines
 * in character has given six lines of evidence about which words it reaches for, and throwing half of
 * it away before judging would make the marker check depend on how many examples a prompt happens to
 * carry. Bounded rather than unbounded only so a runaway answer cannot make this quadratic.
 */
const MAX_SAMPLES_JUDGED = 12;

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
 * ## The field ORDER is load-bearing, and it is what makes the markers good
 *
 * `samples` is asked for BEFORE `dictionMarkers`, which is the opposite of the obvious order and is
 * the single thing that decides whether the marker list is usable. A model answering JSON writes the
 * keys in the order it was shown them and does not go back, so asking for markers first makes it
 * INVENT a list and then, separately, write sample lines — two independent acts of generation that
 * nothing reconciles. The check downstream then compares them and drops most of the list.
 *
 * Measured before changing it: a trawlerman offered `ay`, `tide` and `port` and kept only `blimey`,
 * and a chip-shop soul DJ offered `tonight` and lost it. Every one of those failures is the same
 * failure — a word chosen for the character's WORLD rather than for its sentences.
 *
 * With the samples written first the markers become an EXTRACTION: the model is reading words back
 * off lines it has already committed to, and a word it just used twice is a word it will use again.
 * That also closes the spelling half of it, which nothing else could — `ay` and `aye` are the same
 * marker to an author and different strings to {@link matchesDictionMarker}.
 *
 * ## Naming the categories, because "frequent" is not a category a model can search
 *
 * A model asked for frequent words has no way to rank its own vocabulary, so it falls back to what
 * is DISTINCTIVE — which is exactly wrong. The four categories below are the ones that recur in
 * every break regardless of what the break is about: what the character calls the listener, how it
 * says yes and no, how it contracts, and what it reaches for as filler. A noun cannot be in any of
 * them, which is the point.
 */
export function personaPrompt(description: string): LlmMessage[] {
    return [
        {
            role: 'system',
            content: [
                'You invent presenters for a radio station. Given a description, write one coherent character: who they are, how they speak, and what they play.',
                '',
                'Answer with one JSON object and nothing else, with the keys in this order:',
                '{',
                '  "key": "a short lowercase slug, letters only",',
                '  "label": "what the console calls this character, a few words",',
                '  "style": "completes the sentence \\"You are …\\". A presenter, not a different job. One clause.",',
                '  "djName": "the name they go by on air, or omit it if they are a manner rather than a character",',
                '  "diction": ["how they speak, as rules that apply to EVERY sentence: grammar, contractions, word substitutions"],',
                '  "samples": ["at least six lines in their own voice, as said on air. Between them they must use EVERY diction rule above"],',
                '  "dictionMarkers": ["words COPIED from the sample lines you just wrote — see the rules below"],',
                '  "quirks": ["what they always and never do on air, and what they care about"],',
                '  "catchphrases": ["signature phrases, at most three"],',
                '  "avoid": ["wording that would break the character"],',
                '  "background": "a couple of grounded facts they may mention about themselves",',
                '  "brevity": "omit this unless the character is notably terse; \\"short\\" for one who says less than most, \\"one-line\\" for one who barely speaks",',
                '  "latitude": "omit this unless the character is one that has to be allowed to run: \\"loose\\" for one who follows a thought wherever it goes, \\"unleashed\\" for one who does that and says it however they like",',
                '  "music": "what this character plays, in a sentence",',
                `  "templates": ["five phrasings in this character's voice, one string each. Values you may use: ${TEMPLATE_VALUES.join(' ')}"]`,
                '}',
                '',
                'Rules:',
                '- Write the samples FIRST, then read the markers off them. Do not invent a marker list.',
                // The whole self-check exists because a model asked for distinctive words hands back
                // its six most unusual ones and then never uses them again.
                '- Every marker must appear WORD FOR WORD in at least one sample line, spelled identically. If you wrote "aye" in a sample, the marker is "aye" and never "ay".',
                '- Markers are FREQUENCY, not novelty: the words this character reaches for most, whatever kind of word that turns out to be. Read your own sample lines back and take the ones you used more than once.',
                // Measured, and the reason there is no list of slots here any more. A four-slot list
                // naming an address term and a yes/no put a yes/no marker in 9 of 9 generated
                // personas — a 1940s newsreel announcer came back marked "mate, aye, innit", and
                // "aye" turned up under four unrelated characters. The slots were being filled in
                // rather than the character being read.
                '- There is no fixed list of slots, because characters mark themselves differently. A DIALECT marks itself with grammar and address ("mate", "aye", "in\'"); a MANNER marks itself with appraisal and hedging ("frightful", "rather", "divine", "frankly"); a MOOD marks itself with pace ("easy", "slow", "hush"). Take whichever kind this character actually uses.',
                '- Do not reach for a yes/no word or a name for the listener unless this character genuinely says one in nearly every breath. Most do not.',
                '- A marker is never a noun and never a subject. "tide", "vinyl" and "midnight" are things this character talks about; "aye", "rather", "in\'" and "frankly" are how it talks. Only the second kind belongs here.',
                '- A marker must fit a break about ANY record. If it would sound wrong introducing a song this character dislikes, it is not a marker.',
                '- An ending like "in\'" is worth more than any single word, because it matches every dropped g at once. Include one if the diction drops letters.',
                // Six because the markers are read off these lines and nowhere else, so the sample
                // set is the entire evidence base. A model given three short lines and five diction
                // rules cannot fit them all in, and every rule that misses is a marker lost.
                '- Write at least six samples, and make sure every diction rule is visible somewhere in them. If a rule names a word — "aye", "innit", "mate" — that exact word must appear in a sample, spelled and inflected the same way. A rule you do not demonstrate is a rule the station cannot check.',
                '- The samples are the character talking on air between two records. They must obey the diction rules exactly, because everything else is checked against them.',
                // The floor, and the reason it must be in character: these are what airs when the
                // model declined, which is the ordinary case by design. A plain-English phrasing set
                // makes the character disappear at exactly the moments it was hired for.
                '- The phrasings in "templates" are what the station says when nothing else wrote the break. They are not a fallback to plain English — they are this character speaking, so write them in the same diction as the samples and work its own words into them.',
                '- Change the words AROUND a value, never the value itself. Plain: "That was {{previous.title}}, from {{previous.artist}}." In character: "That there haul was {{previous.title}}, from {{previous.artist}}." The {{...}} stay exactly as given, spelled the same, never translated into the dialect.',
                '- Each must read as a complete sentence once the values are filled in. Wrap a part that can be left out in [[double brackets]]; anything outside those brackets must always be fillable, or the phrasing is never used.',
                // A model bracketing everything "to be safe" leaves a phrasing that renders to its
                // own punctuation. The renderer refuses that now, so an over-bracketed phrasing is
                // simply one the station never says — a wasted line rather than a wrong one.
                '- Never put the whole phrasing in brackets. Something must always be left outside them, or there is no sentence when the optional parts drop away.',
                '- {{clock.rough}} reads as a phrase like "just after nine", so write "It\'s {{clock.rough}}" and never "At the {{clock.rough}}".',
                // Both are literal text that reaches the script and gets read out. Checked now, so
                // asking is what stops the station paying for a line it will throw away.
                '- Use no square brackets except the [[double]] kind, and do not wrap a phrasing in quotation marks. Anything else you type is read out loud exactly as written.',
                // Named shapes rather than a count alone, because five variations on one shape leave
                // the station with nothing to say at the top of an order or on the hour.
                '- Write one of each of these, in this order: (1) what just played and then what is next, (2) only what is next, for the top of a show when nothing has played yet, (3) the station name with both records in [[brackets]], (4) only what just played, (5) one using {{clock.rough}}.',
                '- diction is HOW they talk and quirks are WHAT they talk about. Do not put a subject in diction.',
                // A local model wrapping a long string across lines is invalid JSON and loses the
                // whole persona. `parseLooseJson` repairs it; asking is cheaper than repairing.
                '- Every value is on ONE line. Never break a string across lines, and use plain straight quotes and hyphens.',
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
        // Loose, because the observed failure is a model wrapping a long string across lines and
        // losing the whole persona to a line break. One malformed object still costs itself and
        // nothing after it — the same reason the picks reader parses them separately.
        const parsed = parseLooseJson(span);
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

    // Every sample the model wrote, and then the few that are kept. The check below runs against ALL
    // of them rather than the survivors, because the two caps answer different questions: the stored
    // three are a prompt-budget decision about how many examples a break writer is shown, and this is
    // a question about whether the character says a word at all. A marker earned by the fifth line is
    // still earned, and dropping it because the line was not one of the three shown would be the cap
    // deciding a correctness question it knows nothing about.
    const written = list(raw.samples, MAX_SAMPLES_JUDGED);
    const samples = written.slice(0, PERSONA_SHEET_LIMITS.samples);
    const named = list(raw.dictionMarkers, PERSONA_SHEET_LIMITS.dictionMarkers);
    // Judged against the character's own lines, which is the one check nothing downstream can make:
    // by the time a break declines for missing diction, the sheet has been on air for an evening.
    const markers = named.filter(marker => written.some(sample => dictionMarkersIn([marker], sample).length > 0));

    // Checked rather than taken, so a model answering "terse" or "brief" leaves the field unset —
    // which is the station's ordinary length and the right answer for a value nothing recognises.
    const brevity = isPersonaBrevity(raw.brevity) ? raw.brevity : undefined;
    // Same treatment, and it matters more here: this one moves a word ceiling and a content licence,
    // so a model answering "high" or "free" must leave the character on the station's ordinary
    // discipline rather than on whatever the nearest rung looked like.
    const latitude = isPersonaLatitude(raw.latitude) ? raw.latitude : undefined;

    // Unwrapped BEFORE it is judged, because the quotes are the model's packaging rather than part
    // of the phrasing — a line refused for marks that were never meant to be there would be a line
    // thrown away over punctuation.
    const phrasings = lines(raw.templates).map(unwrapTemplate);
    // Three ways a phrasing is unusable, and only the first was being caught. A lone bracket is TEXT
    // that reaches the script and gets read out, and `unknownPlaceholders` cannot see it because it
    // only ever inspects `{{…}}` — so `[Mate] That was …` passed every check the station had while
    // being certain to air wrongly. The third is a phrasing with no placeholder at all, which is not
    // a phrasing: it is one fixed sentence the station would say between every pair of records.
    const templates = phrasings.filter(line => unknownPlaceholders(line).length === 0 && !hasStrayBracket(line) && line.includes('{{'));

    return {
        draft: {
            key,
            label,
            style,
            ...omitUndefined({
                djName: text(raw.djName),
                background: text(raw.background),
                brevity,
                latitude,
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
    const cleaned = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, '');
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
    const raw = Array.isArray(value)
        ? value.map(entry => (typeof entry === 'string' ? entry : '')).join('\n')
        : typeof value === 'string'
          ? value
          : '';
    return raw
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
}

const nonEmpty = (values: string[]): string[] | undefined => (values.length === 0 ? undefined : values);

function omitUndefined<T extends Record<string, unknown>>(values: T): Partial<T> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}
