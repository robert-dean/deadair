/**
 * A persona's character sheet: who the station is when it opens its mouth.
 *
 * Pure. No I/O, no config, no database — a sheet in, prompt lines out — so everything interesting
 * here is testable without a model, exactly like `break.prompt.ts` beside it.
 *
 * ## Why a sheet rather than a paragraph
 *
 * The station's first answer to "who is the presenter" was one free-text setting appended to the
 * system prompt, and it had three problems that are all the same problem: it could not be checked,
 * it could not reach anything except the model, and its parts could not be treated differently. A
 * sheet separates them, and the separation is what the rest of this file is about.
 *
 * ## Diction is not a quirk, and that is the load-bearing split
 *
 * {@link PersonaSheet.quirks} says what a character talks ABOUT. {@link PersonaSheet.diction} says
 * that "you" is "ye" and "-ing" is "-in'". A quirk applies to the sentences it happens to fit;
 * diction applies to every sentence there will ever be, including the ones stating a plain fact.
 *
 * That difference is why diction is rendered first in the sheet AND restated after the caller's own
 * rules, through {@link personaVoiceReminder}. A local model weights both ends of a prompt hardest,
 * and the failure this addresses is caused by the content rules themselves: a host reads eight
 * careful instructions about naming records accurately and answers them in careful, plain English.
 * The reminder shares the recency position with those rules rather than taking it from them.
 *
 * ## Markers are what make "in character" checkable
 *
 * {@link PersonaSheet.dictionMarkers} are words whose presence proves the dialect survived. Asking
 * for a dialect and hoping is not a design; counting distinct hits in what came back is. The caller
 * decides what to do about a shortfall — here, that is declining to the floor, which is in character
 * anyway.
 *
 * They are also SENT, in the sheet beside the diction they evidence. They were checked and never
 * asked for at first, which made the shortfall a trick question: the station declined good scripts
 * for missing words it had never named, and the floor wrote more than half the breaks on the day
 * the first persona went on air.
 */

/**
 * The facets of a character beyond the one-line style, all optional.
 *
 * A sheet carrying none of them renders to nothing at all, which is what makes an operator who has
 * filled in only a label and a style a legitimate persona rather than a half-configured one.
 */
export interface PersonaSheet {
    /**
     * The dialect itself: grammar and word substitutions that apply to every sentence rather than to
     * a subject. See the note above on why this is not a quirk.
     */
    diction?: readonly string[];
    /**
     * Words and affixes whose presence proves the dialect survived, for {@link dictionMarkersIn}.
     *
     * Matched case-insensitively on word boundaries, except an entry ending in an apostrophe
     * ("in'"), which matches as a word SUFFIX so every dropped-g verb counts without listing them.
     * A curly apostrophe on either side is the same character here; see {@link matchesDictionMarker}.
     *
     * They reach the prompt as well as the check ({@link personaLines}), because a writer marked
     * against words it was never shown is being graded on a rubric it cannot read.
     */
    dictionMarkers?: readonly string[];
    /** What they always and never do on air, and what they care about. */
    quirks?: readonly string[];
    /** Signature phrases. Asked for sparingly, because a catchphrase every break is a jingle. */
    catchphrases?: readonly string[];
    /** Wording that breaks the character. Also the lever against a model's own tells. */
    avoid?: readonly string[];
    /** A couple of grounded facts about the character they may self-reference. */
    background?: string;
    /** Lines in their own voice. The few-shot examples, and what a console previews them with. */
    samples?: readonly string[];
}

/**
 * Caps on how much of a sheet reaches a prompt.
 *
 * A sheet has to stay a sheet. It shares a system turn with the grounding rules, the model is a
 * local one, and every line of flavour here is a line of "never name a record you were not given"
 * further from the end of the prompt. An operator who writes twenty quirks gets the first six.
 */
export const PERSONA_SHEET_LIMITS = {
    diction: 6,
    /** Higher than the rest: markers are single words, and the check needs enough to be fair. */
    dictionMarkers: 16,
    quirks: 6,
    catchphrases: 6,
    avoid: 12,
    samples: 3,
} as const;

/** How many example lines a prompt carries by default. Enough to set a rhythm, few enough to read. */
const MAX_EXAMPLES = 3;

/** Diction clauses restated in the closing reminder. Two: enough to anchor, short enough to land. */
const REMINDER_CLAUSES = 2;

/**
 * How much evidence of character a script must carry to count as still in character.
 *
 * One, and the argument for two did not survive being measured. It was that a single hit is as
 * likely to be a coincidence as a dialect, which was true while the markers were counted but never
 * sent: a model that has not been told which words are being marked can only hit one by accident.
 * Now that {@link personaLines} names them, a hit is a followed instruction.
 *
 * What settled it is that two declined the station's OWN writing. Six of the twenty sample lines in
 * `persona.defaults.ts` carry exactly one marker, including both of `wisecrack`'s — so the prompt
 * handed a model two examples, told it to reuse their grammar, and the guard refused what came
 * back. A sheet whose diction says "one aside per record, and only one" cannot also be asked for two
 * marked words in fifteen. A floor its author's own reference lines fail is measuring the floor
 * rather than the script.
 *
 * One still catches the failure this exists for, which is a break that came back in flat plain
 * English with no trace of the character at all.
 */
export const MIN_DICTION_MARKERS = 1;

export interface PersonaLineOptions {
    /** Example lines woven in. Defaults to {@link MAX_EXAMPLES}. */
    maxExamples?: number;
}

/**
 * A sheet as system-prompt lines: how they speak, what they do, what they own, what breaks them,
 * what is true about them, and a few lines in their voice.
 *
 * Answers `[]` for a sheet carrying nothing, so a prompt built around a bare persona is byte-identical
 * to the one built around no persona at all. Callers place these AFTER their role line and BEFORE
 * their content rules, leaving the grounding discipline where it has always been.
 */
export function personaLines(sheet: PersonaSheet, opts: PersonaLineOptions = {}): string[] {
    const lines: string[] = [];

    // Dialect leads: it governs every sentence, while everything below governs only the sentences it
    // happens to apply to.
    const diction = cleanList(sheet.diction, PERSONA_SHEET_LIMITS.diction);
    if (diction.length > 0) lines.push(`How you speak — every sentence, no exceptions: ${joinClauses(diction)}`);

    // Beside the diction, because they are the same instruction said twice: the clauses above are
    // the rule and these are the evidence of it. Sent at all because they are what `keepsCharacter`
    // COUNTS, and for as long as they were checked but never asked for, the station was declining
    // scripts for missing words it had not named — a model writing a perfectly good line in
    // character had no way to know which of its words were being marked. Phrased as a floor rather
    // than a list to work through: {@link MIN_DICTION_MARKERS} is what the guard wants, and a break
    // that used all sixteen would be a parody of the character rather than the character.
    const markers = cleanList(sheet.dictionMarkers, PERSONA_SHEET_LIMITS.dictionMarkers);
    if (markers.length > 0) {
        lines.push(
            `These words are yours. Work at least ${MIN_DICTION_MARKERS} of them into anything you say, where it falls naturally — ` +
                `never listed, and never all at once: ${markers.join(', ')}`,
        );
    }

    const quirks = cleanList(sheet.quirks, PERSONA_SHEET_LIMITS.quirks);
    if (quirks.length > 0) lines.push(`In character: ${joinClauses(quirks)}`);

    const catchphrases = cleanList(sheet.catchphrases, PERSONA_SHEET_LIMITS.catchphrases);
    if (catchphrases.length > 0) {
        lines.push(`You have signature phrases. Use at most one, and not every time: ${catchphrases.map(phrase => `"${phrase}"`).join('; ')}`);
    }

    const avoid = cleanList(sheet.avoid, PERSONA_SHEET_LIMITS.avoid);
    if (avoid.length > 0) lines.push(`Never say: ${avoid.join('; ')}`);

    const background = sheet.background?.trim();
    if (background !== undefined && background.length > 0) lines.push(`True about you, if it comes up: ${background}`);

    const examples = cleanList(sheet.samples, Math.max(0, opts.maxExamples ?? MAX_EXAMPLES));
    if (examples.length > 0) {
        // "Do not reuse the words" was the whole instruction once, and a model read it as leave to
        // drop the dialect along with the wording. Reuse the grammar; only the sentences must be new.
        lines.push('This is your speech and rhythm — reuse the grammar, never the sentences:');
        lines.push(...examples.map(example => `- "${example}"`));
    }

    return lines;
}

/**
 * The closing "stay in dialect" line, for a caller to append AFTER its own content rules.
 *
 * Undefined for a sheet with no {@link PersonaSheet.diction}, so a prompt without one is unchanged.
 * See the note at the top of this file for why this exists at all when the same clauses are already
 * in the sheet above.
 */
export function personaVoiceReminder(sheet: PersonaSheet): string | undefined {
    const diction = cleanList(sheet.diction, REMINDER_CLAUSES);
    if (diction.length === 0) return undefined;

    return `Write every sentence in your own speech — ${joinClauses(diction)} Plain English is wrong here, including when you are stating a fact.`;
}

/**
 * Every character a writer might use where the sheet wrote a plain `'`.
 *
 * A model emits U+2019 far more often than it emits an ASCII apostrophe — measured at 35 of 47
 * written breaks on this station — and a sheet is typed by hand, so the two sides of this comparison
 * disagree by default rather than by accident. See {@link straightenApostrophes}.
 */
const CURLY_APOSTROPHES = /[‘’ʼ′]/g;

/**
 * One apostrophe, so a marker and a script can be compared at all.
 *
 * This is not tidying. Without it `matchesDictionMarker` failed in BOTH directions at once, and the
 * two failures hid each other: every marker carrying an apostrophe ("that's", "in'", "'tis") could
 * never match a model's `that’s`, while the boundary below — which excluded `'` from a word but not
 * `’` — let a bare "you" match inside `you’re`. So a sheet whose diction says "always contract" had
 * its markers structurally unmatchable, and the one persona that appeared to work was passing on an
 * accident. Six of the ten seeded sheets carry apostrophe markers.
 */
const straightenApostrophes = (text: string): string => text.replace(CURLY_APOSTROPHES, "'");

/**
 * Whether a marker appears in `text`, case-insensitively.
 *
 * A marker ending in an apostrophe ("in'") matches as a word SUFFIX, so every dropped-g verb counts
 * without the sheet listing them all. Anything else matches whole-word, so "aye" is not found inside
 * "player" — which is not a hypothetical, since a station's own vocabulary is full of near misses.
 *
 * Both sides are straightened first, because a curly apostrophe is the same word said the same way.
 */
export function matchesDictionMarker(marker: string, text: string): boolean {
    const needle = straightenApostrophes(marker.trim().toLowerCase());
    if (needle.length === 0) return false;

    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // An apostrophe is a word character to no regex engine, so a trailing one needs its own
    // boundary: preceded by letters, followed by a non-letter.
    const pattern = needle.endsWith("'") ? `[a-z]${escaped}(?![a-z])` : `(?<![a-z'])${escaped}(?![a-z'])`;
    return new RegExp(pattern).test(straightenApostrophes(text.toLowerCase()));
}

/**
 * The distinct catchphrases a script carries.
 *
 * Matched as a plain substring rather than on word boundaries, because a catchphrase is a phrase and
 * already carries its own edges. Apostrophes are straightened on both sides for the same reason they
 * are in {@link matchesDictionMarker}.
 */
export function catchphrasesIn(catchphrases: readonly string[] | undefined, script: string): string[] {
    const text = straightenApostrophes(script.toLowerCase());
    return cleanList(catchphrases, PERSONA_SHEET_LIMITS.catchphrases).filter(phrase =>
        text.includes(straightenApostrophes(phrase.trim().toLowerCase())),
    );
}

/** The distinct markers a script carries. Its length is what a caller judges. */
export function dictionMarkersIn(markers: readonly string[] | undefined, script: string): string[] {
    return cleanList(markers, PERSONA_SHEET_LIMITS.dictionMarkers).filter(marker => matchesDictionMarker(marker, script));
}

/**
 * Whether a script still sounds like the persona that was asked for.
 *
 * True for a sheet that named no markers, and deliberately: a persona whose author gave nothing to
 * check against has made no checkable claim, and refusing its scripts would punish the operator for
 * filling in fewer boxes.
 *
 * A CATCHPHRASE counts as evidence beside a marker, because it is the least ambiguous evidence there
 * is — a marker can appear in plain English by chance and a signature phrase cannot. A break ending
 * "Make of that what you will" was being declined as out of character while carrying the persona's
 * own signature, which is the guard contradicting the sheet three lines above it.
 *
 * The claim is still keyed on MARKERS alone. Catchphrases only ever add evidence and never create
 * the requirement, because the prompt asks for one "at most one, and not every time" — so a sheet
 * carrying catchphrases and no markers has still made no checkable claim, and a script that used no
 * catchphrase has done exactly what it was told.
 */
export function keepsCharacter(sheet: PersonaSheet, script: string): boolean {
    const markers = cleanList(sheet.dictionMarkers, PERSONA_SHEET_LIMITS.dictionMarkers);
    if (markers.length === 0) return true;

    const evidence = dictionMarkersIn(markers, script).length + catchphrasesIn(sheet.catchphrases, script).length;
    return evidence >= MIN_DICTION_MARKERS;
}

/** Trim, drop blanks, de-duplicate case-insensitively, and cap. The sheet's one normalizer. */
function cleanList(values: readonly string[] | undefined, max: number): string[] {
    if (values === undefined || max <= 0) return [];

    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of values) {
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (value.length === 0) continue;

        const key = value.toLowerCase();
        if (seen.has(key)) continue;

        seen.add(key);
        out.push(value);
        if (out.length >= max) break;
    }
    return out;
}

/** Join sheet clauses into one sentence, without doubling a trailing full stop. */
function joinClauses(values: readonly string[]): string {
    return `${values.map(value => value.replace(/[.;]\s*$/, '')).join('; ')}.`;
}
