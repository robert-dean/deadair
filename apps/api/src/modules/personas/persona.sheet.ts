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
 *
 * ## A pasted character is not a character, which is the fault {@link characterFault} exists for
 *
 * Measured on this station, over seventeen consecutive model breaks under one persona: fifteen of
 * them ended with a signature line or a sample line reproduced word for word. `Okay that was rough
 * and I picked it, so that's on me` went out four times, once behind `Oh boy, Anvil dropping
 * Paranormal now!`, where it means nothing at all. `I said what I said` closed a talk break, a
 * welcome and a NEWS BULLETIN.
 *
 * What that is, exactly: plain announcer English in the middle, a marker bolted to the front and a
 * quoted signature bolted to the end. Every one of those scripts passed {@link keepsCharacter},
 * because a pasted catchphrase is precisely the evidence it counts — so the guard was reading the
 * decoration as the voice.
 *
 * So the sheet now judges three more things, and each is the enforcement of a line the sheet was
 * already sending and nothing was checking:
 *
 * - **A sample may not be echoed** ({@link echoedSample}). The prompt says reuse the grammar and
 *   never the sentences; this is what makes that true.
 * - **A signature already heard is spent** ({@link spentCatchphrases}). The prompt says "at most
 *   one, and not every time", and "not every time" was the half with nothing behind it. The model is
 *   TOLD which ones are spent, in the user turn beside the recent scripts, and invited to invent one
 *   of its own instead — so this refuses a script for an instruction it was given, which is the same
 *   bargain the markers are on.
 * - **`avoid` is a list of things not to say** ({@link avoidedWording}), and it went out on every
 *   prompt with nothing reading the answer back against it. A break saying "buckle up" aired under a
 *   persona whose sheet forbids exactly that, in exactly those words.
 *
 * All three DECLINE rather than repair, for the reason the marker check does: the floor underneath
 * is written in the same character, so the station gets an in-character line at once instead of
 * paying for a second generation to maybe get one.
 */

/** How much a character says, below the station's ordinary length. See {@link PersonaSheet.brevity}. */
export const PERSONA_BREVITIES = ['short', 'one-line'] as const;

export type PersonaBrevity = (typeof PERSONA_BREVITIES)[number];

/** Whether a stored value is a rung, so a hand-edited row cannot put nonsense in a prompt. */
export const isPersonaBrevity = (value: unknown): value is PersonaBrevity => PERSONA_BREVITIES.includes(value as PersonaBrevity);

/**
 * What each rung asks for.
 *
 * Phrased as a shape rather than as a number, because a count is the thing the ceiling already
 * states and stating it twice invites a model to treat the smaller one as the real limit and pad up
 * to it. "Name it and get out of the way" is an instruction about what a break IS.
 */
const BREVITY_INSTRUCTIONS: Record<PersonaBrevity, string> = {
    short: 'You say less than most presenters. One sentence, two at the very most, and leave the space rather than filling it.',
    'one-line': 'You say almost nothing. One short sentence: name the thing and get out of the way.',
};

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
    /**
     * How much this character says, or absent for the station's ordinary length.
     *
     * ## Only rungs below the default, which is the design rather than half a list
     *
     * Measured on this station: 2 of 137 captured answers reached {@link DEFAULT_MAX_WORDS} and the
     * median came in at 28 words. So the ceiling was never what bounded a break — the model stops on
     * its own — and what it spends those 28 words on is the whole question. A rung ABOVE the default
     * would need the ceiling raised, which was considered against that same measurement and rejected
     * because it permits something nothing was asking for. Asking for LESS is the doctrine that
     * produced "make one point".
     *
     * ## It changes the instruction and never the ceiling
     *
     * The trap here, stated because the fix somebody will reach for is exactly wrong: `readAnswer`'s
     * word ceiling DECLINES a long script rather than trimming it, so lowering `maxWords` to match a
     * terse character would refuse the median break and hand every one of theirs to the phrasings.
     * A station would look like it had no model at all, which is the failure a persona is supposed to
     * survive rather than cause. So this is an instruction and nothing checks it, exactly like "make
     * one point" beside it in the rules.
     */
    brevity?: PersonaBrevity;
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

/**
 * How many consecutive words a script may share with one of the sheet's {@link PersonaSheet.samples}.
 *
 * Five, so a script may pick up a signature phrase or a turn of grammar and may not pick up a
 * sentence. Every catchphrase on every seeded persona is four words or fewer, which is what sets
 * this: the shortest thing a persona is allowed to reuse has to fit under it, and the shortest thing
 * it is not allowed to reuse — a sample clause — has to not.
 *
 * A run rather than the whole line, because the observed failure is not always a clean copy. "Okay
 * that was rough and I picked it, so that's on me" came back once entire and once truncated at "I
 * picked it", and a check that only caught the first would have passed the second as original work.
 */
export const MAX_SAMPLE_ECHO_WORDS = 5;

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
        // The invitation at the end is the positive half of the rule the user turn enforces. A
        // signature the station has just used is refused there, and a model told only that has been
        // left with a hole where its sign-off was — which it fills by reaching for a sample line
        // instead. So it is told what to do with the hole: make a new one. A phrase invented in
        // character is the character working, where a phrase quoted from the sheet is the character
        // being pasted, and only the second is what a listener hears as a recording.
        lines.push(
            `You have signature phrases. Use at most one, and not every time: ${catchphrases.map(phrase => `"${phrase}"`).join('; ')}. ` +
                'A new line of your own in the same voice is always better than repeating one of these.',
        );
    }

    const avoid = cleanList(sheet.avoid, PERSONA_SHEET_LIMITS.avoid);
    if (avoid.length > 0) lines.push(`Never say: ${avoid.join('; ')}`);

    const background = sheet.background?.trim();
    if (background !== undefined && background.length > 0) lines.push(`True about you, if it comes up: ${background}`);

    const examples = cleanList(sheet.samples, Math.max(0, opts.maxExamples ?? MAX_EXAMPLES));
    if (examples.length > 0) {
        // "Do not reuse the words" was the whole instruction once, and a model read it as leave to
        // drop the dialect along with the wording. Reuse the grammar; only the sentences must be new.
        //
        // The refusal is stated because it is now real: `echoedSample` declines a script that lifts
        // a clause from one of these, and an instruction whose enforcement is invisible is one a
        // model has no reason to weigh against the pull of an example sitting right in front of it.
        lines.push('This is your speech and rhythm — reuse the grammar, never the sentences. A line lifted from one of these is thrown away:');
        lines.push(...examples.map(example => `- "${example}"`));
    }

    // LAST, so it sits against the caller's own job line and the rules under it: everything above is
    // who this character is, and this is how much of it they say. A length instruction belongs beside
    // the word ceiling rather than among the facets of a voice.
    if (sheet.brevity !== undefined && isPersonaBrevity(sheet.brevity)) lines.push(BREVITY_INSTRUCTIONS[sheet.brevity]);

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

/**
 * Whether a phrase appears in `text` as words rather than as characters.
 *
 * The `avoid` list's own matcher. Not {@link catchphrasesIn}'s plain substring, because that list is
 * full of single common words — "folks", "amazing", "incredible" — and a substring test refuses a
 * break for saying "Folkstone" or "incredibly". Internal whitespace is matched loosely, so a sheet
 * that wrote "buckle up" still catches "buckle  up" across a line break.
 */
function containsPhrase(phrase: string, text: string): boolean {
    const needle = straightenApostrophes(phrase.trim().toLowerCase());
    if (needle.length === 0) return false;

    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?<![a-z'])${escaped}(?![a-z'])`).test(straightenApostrophes(text.toLowerCase()));
}

/**
 * The wording from {@link PersonaSheet.avoid} that a script used anyway.
 *
 * Only the PHRASE-shaped entries can be caught here, and that is a real limit rather than a
 * temporary one: a sheet's avoid list mixes literal wording ("buckle up", "without further ado")
 * with descriptions of a subject ("anything about a listener's body, money, family or
 * intelligence"), and the second kind is an instruction to a model that no string comparison can
 * enforce. Those entries simply never match, which costs nothing — they are still sent, and the
 * grounding rules underneath them are what actually hold.
 *
 * So this closes the half that is checkable, and the half it closes is the one that was observed
 * failing: a break went out saying "buckle up" under a sheet forbidding it in those exact words.
 */
export function avoidedWording(sheet: PersonaSheet, script: string): string[] {
    return cleanList(sheet.avoid, PERSONA_SHEET_LIMITS.avoid).filter(phrase => containsPhrase(phrase, script));
}

/**
 * The sample line a script lifted a clause from, or `undefined`.
 *
 * Compared as words rather than as text so punctuation, capitals and a curly apostrophe cannot hide
 * a copy. A sample shorter than {@link MAX_SAMPLE_ECHO_WORDS} has to appear whole to count, which is
 * the same rule and not a special case: there is no longer run in it to find.
 */
export function echoedSample(sheet: PersonaSheet, script: string): string | undefined {
    const spoken = ` ${wordsOf(script).join(' ')} `;

    return cleanList(sheet.samples, PERSONA_SHEET_LIMITS.samples).find(sample => {
        const words = wordsOf(sample);
        const run = Math.min(words.length, MAX_SAMPLE_ECHO_WORDS + 1);
        if (run === 0) return false;

        for (let i = 0; i + run <= words.length; i++) {
            if (spoken.includes(` ${words.slice(i, i + run).join(' ')} `)) return true;
        }
        return false;
    });
}

/**
 * The signatures the station has said recently, and so may not say again now.
 *
 * `recent` is the last few scripts of this KIND, which is what makes "not every time" a question
 * about what a listener has actually heard rather than about a counter. A persona with no
 * catchphrases, or a station with nothing behind it, spends nothing.
 *
 * **A catchphrase that is also a diction marker can never be spent.** The seeded `wisecrack` carries
 * "Anyway" as both, which is a sheet contradicting itself: the marker line asks for that word in
 * every break and the catchphrase line rations it, and without this the guard would refuse a script
 * for obeying the first. Diction wins, on the argument this whole file is built on — a quirk applies
 * to the sentences it fits and diction applies to every sentence there will ever be, so a word doing
 * both jobs is doing the bigger one.
 */
export function spentCatchphrases(sheet: PersonaSheet, recent: readonly string[] | undefined): string[] {
    if (recent === undefined || recent.length === 0) return [];

    const markers = new Set(cleanList(sheet.dictionMarkers, PERSONA_SHEET_LIMITS.dictionMarkers).map(marker => marker.toLowerCase()));
    const spendable = cleanList(sheet.catchphrases, PERSONA_SHEET_LIMITS.catchphrases).filter(phrase => !markers.has(phrase.toLowerCase()));

    return catchphrasesIn(spendable, recent.join('\n'));
}

/** What a script did that means it is not this character speaking. See {@link characterFault}. */
export type CharacterFault =
    /** A clause lifted from one of the sheet's own sample lines. */
    | 'quoted-sample'
    /** A signature phrase the station has just used. */
    | 'spent-catchphrase'
    /** Wording the sheet forbids. */
    | 'avoided-wording'
    /** Nothing in it carries the dialect at all. */
    | 'out-of-character';

/** What the caller knows about the moment, for the checks that are about more than the script. */
export interface CharacterContext {
    /** The last few things the station said, as `BreakWriteRequest.recent` holds them. */
    recent?: readonly string[];
}

/**
 * Why this script is not the persona speaking, or `undefined` when it is.
 *
 * The whole judgement in one call, so a caller cannot enforce three of the four and quietly leave
 * the fourth as decoration — which is exactly how the sheet ended up sending an `avoid` list nobody
 * read. It answers WHICH fault rather than a boolean because the four want quite different fixes and
 * look identical from the row: a spent signature is the station working as designed, a quoted sample
 * is a sheet whose examples are too magnetic for the model in front of them, forbidden wording is
 * worth an operator's attention, and a flat plain-English line is markers or diction wanting work.
 *
 * Ordered by how specific the fault is rather than by severity: all four decline, so the only thing
 * the order decides is what the log says, and the narrower reason is the more useful one.
 */
export function characterFault(sheet: PersonaSheet, script: string, context: CharacterContext = {}): CharacterFault | undefined {
    if (echoedSample(sheet, script) !== undefined) return 'quoted-sample';
    if (avoidedWording(sheet, script).length > 0) return 'avoided-wording';

    const spent = spentCatchphrases(sheet, context.recent);
    if (spent.length > 0 && catchphrasesIn(spent, script).length > 0) return 'spent-catchphrase';

    return keepsCharacter(sheet, script) ? undefined : 'out-of-character';
}

/** A text as bare lower-case words, so two of them can be compared as speech rather than as text. */
function wordsOf(text: string): string[] {
    return straightenApostrophes(text.toLowerCase())
        .replace(/[^a-z0-9']+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
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
