/**
 * A written script as the words a speech engine can actually say.
 *
 * The words a break is WRITTEN in and the words an engine can read are not the same words, and until
 * this file there was nothing between them: a script went from `segments.script` into `speak` exactly
 * as it was stored, `&` and `feat.` and `1984` and a stray asterisk included. What the engine did with
 * those was per engine, unrecorded, and heard once — a reading cannot be taken back the way a bad
 * line can, and there is nobody to blame for it, because the script was right.
 *
 * Its sibling is `spoken()` in `director/talk.break.writer.ts`, which is about what a TITLE carries
 * (a remaster year, a deluxe marker) and runs at write time so a model sees clean words too. This is
 * about what a STRING can be pronounced as, and runs at render time on everything: every writer, every
 * kind, an imported script an operator typed, a beat of a production.
 *
 * ## The order is the design
 *
 * Six passes, and swapping any two of them changes the answer:
 *
 * 1. **Tidy** — the marks that are not speech at all: markdown a model left behind, an emoji, a URL,
 *    a line break in the middle of a bulletin.
 * 2. **Pronunciations** — the operator's list, BEFORE anything touches symbols, because half of the
 *    entries worth writing are stylized names made of symbols and `&` becoming "and" first would
 *    leave nothing for `P!nk` to match.
 * 3. **Symbols** — the ones that stand in for words.
 * 4. **Numbers**, conservatively; see {@link sayNumbers}.
 * 5. **Initialisms** — dotted forms, and a short list of the ones a station says constantly.
 * 6. **Settle** — collapse what the passes above left, and drop what no engine can say.
 *
 * ## What it deliberately does not do
 *
 * It does not touch a plain integer, and it does not space out an undotted run of capitals. Both are
 * cases where the wrong answer is as likely as the right one — `ABBA` is a word and `MGMT` is not,
 * and nothing in a regular expression knows which — and where being wrong is a new mispronunciation
 * rather than the one being fixed. That gap is exactly what the operator's list is for.
 *
 * Pure, and takes its entries as an argument: no DI, no config, no clock. `SpeechService` is what
 * knows where a lexicon comes from.
 */

import { SPEECH_CUES } from '@deadair/plugin-sdk';

import { withoutPads } from './pad.cues.js';
import { applyPronunciations, type Pronunciation } from './pronunciation.lexicon.js';

/**
 * The decoration {@link settle} drops, with a performance cue held out of it.
 *
 * The cue alternative comes FIRST, which is the whole trick: a regular expression takes the earliest
 * alternative that matches at a position, so `[laugh]` is claimed as a cue before the bare `[` in the
 * character class can claim it. Reverse them and every cue loses its opening bracket.
 */
const SPARE_CUES = new RegExp(`\\[(${[...SPEECH_CUES].sort((left, right) => right.length - left.length).join('|')})\\]|[*_\`^<>{}[\\]=+@#&$%]`, 'gi');

/**
 * One script, as it should be handed to an engine.
 *
 * Answers the original text when the passes leave nothing, which is the same rule `spoken()` applies
 * when a title looked like nothing but furniture: an empty reading means the transposition was wrong,
 * not that the script had nothing in it. A station saying something odd is recoverable; a segment
 * that renders silence is a hole in the hour.
 */
export function transposeForSpeech(text: string, entries: readonly Pronunciation[] = []): string {
    const original = text.trim();

    // Pad hits come out FIRST, before any pass has a chance to mangle one into something speakable.
    //
    // This is not tidying, it is the boundary: a `[sfx:airhorn]` is performed by the JOIN, out of a
    // file, and the engine's part in it is to say the words either side. There is no `SPARE_CUES`
    // equivalent to hold it out of {@link settle}, and there must not be — that regex's character
    // class contains `[` and `]`, so a pad reaching it would come out as the bare text `sfx:airhorn`
    // and be READ ALOUD. Which is the whole failure this file exists to prevent, arriving through the
    // one door it had not been closed on.
    //
    // Every pad, with no allow-list: what a character may hit was decided at write time by
    // `keepPads`, and a script arriving here with a cue in it is a script that already passed that.
    let spoken = withoutPads(original);
    spoken = tidy(spoken);
    spoken = applyPronunciations(spoken, entries);
    spoken = saySymbols(spoken);
    spoken = sayNumbers(spoken);
    spoken = sayInitialisms(spoken);
    spoken = settle(spoken);

    return spoken.length === 0 ? original : spoken;
}

/**
 * The marks that are not speech.
 *
 * Everything here is something a model or a paste produced that an engine would either read out loud
 * or trip over. `readAnswer` already strips the theatrical half of this (a `[warmly]`, a `DJ:` label)
 * from a model's answer — this is the rest, and it runs on every script rather than only a model's,
 * because an operator pasting a line from a document brings the same characters with them.
 */
function tidy(text: string): string {
    return (
        joinLines(text)
            // A URL is not a sentence, and an engine reading one aloud is the worst possible outcome
            // for a station that meant to say a name.
            .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
            // Emoji and their variation selectors, which have no reading at all.
            .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')
            // Markdown emphasis, kept as its own words: `**loud**` is a word, not a mark.
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/_([^_]+)_/g, '$1')
            .replace(/`+/g, ' ')
            // Typography, as the plain marks the engine's own normalizer expects.
            .replace(/[‘’‛]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/…/g, '...')
            // A non-breaking hyphen is a hyphen; nothing reads the code point itself.
            .replace(/‑/g, '-')
            // A dash between words is a PAUSE, so it becomes the mark that means one. It was a spaced
            // hyphen for one draft, which is worse than either: measured against the station's own
            // scripts, a model writing in this voice reaches for an em dash constantly ("Deadair—feel
            // it"), and a lone hyphen is a character some engines read as a word and others swallow
            // along with the pause it was standing for.
            .replace(/\s*[–—]\s*/g, ', ')
    );
}

/**
 * Lines as sentences.
 *
 * A break is one paragraph and a bulletin is several lines, and an engine handed a bare newline
 * either ignores it or pauses arbitrarily. A line already ending in punctuation keeps it; one that
 * does not gets a full stop, because two headlines run together as one sentence is the thing a
 * bulletin most needs not to do.
 */
function joinLines(text: string): string {
    const lines = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    return lines.reduce((said, line) => (said.length === 0 ? line : `${said}${/[.!?:;,]$/.test(said) ? '' : '.'} ${line}`), '');
}

/**
 * The symbols that stand in for words.
 *
 * Every one of these is read by SOME engine and skipped by another, which is the actual problem: a
 * station cannot be tuned against a behaviour that is not written down anywhere. Saying them here
 * makes the reading the same on every engine, which is worth slightly more than any one engine's own
 * cleverness.
 *
 * `$` is the one that is guessed rather than known — a bare `$5` cannot be dropped, because the
 * number without it is a different fact — so it is read as dollars and an operator whose station
 * talks in another currency has a list to fix it in. What the amount IS goes with it; see
 * {@link MONEY_SCALES}.
 */
function saySymbols(text: string): string {
    return (
        text
            // Abbreviations first, while their full stops are still attached: `feat.` has to be seen
            // as one thing before anything decides what a lone `.` means.
            .replace(/\b(?:feat|ft)\.?(?=\s)/gi, 'featuring')
            .replace(/\bvs\.?(?=\s|$)/gi, 'versus')
            .replace(/\bw\/(?=\s)/gi, 'with')
            .replace(/\bNo\.\s*(?=\d)/g, 'number ')
            .replace(/\bDr\.(?=\s)/g, 'Doctor')
            .replace(/\bMr\.(?=\s)/g, 'Mister')
            .replace(/\bMrs\.(?=\s)/g, 'Missus')
            .replace(/\bMs\.(?=\s)/g, 'Miss')
            .replace(/\bSt\.(?=\s)/g, 'Saint')
            .replace(/\betc\./gi, 'et cetera')
            .replace(/\be\.g\.(?=\s)/gi, 'for example')
            .replace(/\bi\.e\.(?=\s)/gi, 'that is')
            // `#1` and `#hashtag` are different things and only the first is a number.
            .replace(/#(?=\d)/g, 'number ')
            // The whole AMOUNT, not its first digit and not its digits alone: `$5.99` is one figure
            // and `$17.1 billion` is one amount, and the word goes after all of what it names. The
            // marker survives {@link settle}'s drop-list and becomes the word there, singular or
            // plural as {@link modifiesWhatFollows} read the sentence. See {@link MONEY_SCALES}.
            .replace(MONEY, (all: string, figure: string, scale: string | undefined, offset: number, whole: string) => {
                const marker = modifiesWhatFollows(whole.slice(offset + all.length)) ? '#DOLLAR#' : '#DOLLARS#';
                if (scale === undefined) return `${figure}${marker}`;

                // An abbreviation is said as the word it stands for; a word the writer already spelled
                // out is kept exactly as written, so `Billion` at the head of a headline stays capital.
                const spelled = MONEY_SCALES[scale.trim().toLowerCase()];
                return spelled === undefined ? `${figure}${scale}${marker}` : `${figure} ${spelled}${marker}`;
            })
            .replace(/&/g, ' and ')
            .replace(/\s@\s/g, ' at ')
            .replace(/%/g, ' percent')
            .replace(/(\d)\s*\+/g, '$1 plus')
    );
}

/**
 * What an abbreviated amount stands for, so `$100K` is a hundred thousand dollars out loud.
 *
 * Only the abbreviations are here. A scale word the writer already spelled out needs no lookup — it
 * is carried through as written — and keeping it out of this table is what stops `million` being
 * rewritten by the `m` entry.
 *
 * Bare letters are safe here and nowhere else in this file, because they are read only in the two
 * characters after a `$`. `m` alone is metres, minutes or a middle initial; `$5m` is five million
 * dollars and nothing else. {@link MONEY} is what holds them to that position.
 */
const MONEY_SCALES: Record<string, string> = { k: 'thousand', m: 'million', bn: 'billion', b: 'billion', t: 'trillion' };

/**
 * An amount of money, as far as its scale word.
 *
 * ## The failure
 *
 * This used to end at the digits, which put the marker between a figure and the word saying how big
 * it is: `$17.1 Billion` was transposed to `17.1#DOLLARS# Billion` and **aired as "seventeen point
 * one dollars billion"**. It happened four times on this station — Meta's settlement twice at $17.1
 * and $18 billion, and a $100 billion spaceport twice — and it is the reading a listener notices
 * fastest, because it is the one they can hear is nonsense without knowing the story.
 *
 * The measured distribution behind the two branches, from every script this station has written that
 * contains a `$`: twenty amounts carry a spelled scale word (`billion` and `Billion` both, after both
 * whole and decimal figures) and one carries an abbreviation, `$100K`, which was airing as "100
 * dollars K".
 *
 * ## Why the two branches differ
 *
 * A spelled word takes optional space and is CONSUMED, since it already reads correctly and only
 * needs to end up on the right side of the marker. An abbreviation takes NO space and is REPLACED,
 * because consuming it alone would leave "100K dollars" for an engine to guess at, which is the same
 * bug one step quieter.
 *
 * `\b` after the abbreviation is what keeps it to its own two characters: it fails on the `i` of
 * `$5 million`, so a spelled word can never be eaten by the letter branch, and it fails on `$99.99
 * Plaud`, which is a price followed by a product rather than a scale.
 *
 * ## A comma is a separator or it is punctuation, and the figure may only have the first
 *
 * The digits were `\d[\d,]*`, which ends on a comma as happily as on a digit, so a price at the end
 * of a clause took the clause's comma into the amount and the marker went in behind it: `$750, save
 * almost $500` **aired as "750, dollars save"**. Grouping the separator with the three digits it
 * separates is what tells the two apart — `103,000` is one figure and `8,` is a figure and then a
 * pause — and it costs nothing, because a thousands separator with anything but three digits after
 * it was never a thousands separator.
 */
const MONEY = /\$(\d+(?:,\d{3})*(?:\.\d+)?)(\s*(?:bn|k|m|b|t)\b|\s+(?:hundred|thousand|million|billion|trillion)\b)?/gi;

/**
 * The words that cannot be a thing an amount of money is describing.
 *
 * English puts money in two positions and says the currency differently in each: standing on its own
 * it is plural ("Meta will pay 17.1 billion DOLLARS"), and in front of the thing it describes it is
 * singular ("a 100 billion DOLLAR spaceport"). Nothing here knows what a word is, so the question has
 * to be decided from the word after the amount, and **the only tractable direction is this one**:
 * what an amount describes is a NOUN, which is an open class nothing can enumerate, while what
 * follows a standing amount is a preposition, a conjunction, an auxiliary or a pronoun — closed
 * classes, finite, and listable. So this names what CANNOT follow attributively and everything else
 * is taken to be the noun. It is the argument {@link settle} makes about its own drop-list, one pass
 * along: matching what to keep has no gap, and matching what to drop always does.
 *
 * ## What it can get wrong, and which way
 *
 * A verb or an adverb missing from here reads as a noun, and the amount in front of it goes singular:
 * "500 dollar will be spent". That is the failure to watch for and this list is where it is fixed —
 * the participles and the frequency adverbs at the end are here because the station wrote them
 * ("$21,000 spent", "$39,800 monthly") rather than because the class is complete.
 *
 * The other direction is safe by construction: every function word here is a word no amount has ever
 * described, so nothing in this list can wrongly turn an attributive amount plural.
 */
const NOT_A_THING_MONEY_BUYS = new Set([
    // Determiners, possessives and pronouns.
    ...'a an the this that these those each every another any some no its his her their our my your it he she they we you i them him us me'.split(
        ' ',
    ),
    // Prepositions, including the ones an amount most often lands in front of: `in`, `on`, `off`, `per`.
    ...'in on at for to from of with by off per under over into onto after before during since until about across through than toward towards upon within without against between among around up down out near via versus'.split(
        ' ',
    ),
    // Conjunctions and the subordinators that open a clause after an amount.
    ...'and or but so yet nor if because while when where as though although unless whether'.split(' '),
    // Auxiliaries and the verbs a bare amount is most often the subject of.
    ...'is was are were be been being will would can could shall should may might must has have had do does did went goes come comes came get gets got said says makes made'.split(
        ' ',
    ),
    // Comparatives and the adverbs that follow an amount rather than being bought by one.
    ...'more less higher lower apiece total altogether overall alone already still now then today yesterday instead again respectively'.split(' '),
    // Where and when, which is the group a first pass of this list forgot: `$5.99 back then` and
    // `$100K last month` both read as an amount buying a thing until `back` and `last` were here.
    ...'back ahead away aside apart along last next past ago early earlier late later soon once twice here there elsewhere'.split(' '),
    // Participles the station has actually written after an amount. Not a complete class; see above.
    ...'spent raised paid invested saved pledged committed awarded secured allocated borrowed earned lost worth'.split(' '),
    // Frequencies, which read as adverbs here rather than as something an amount describes.
    ...'monthly weekly yearly annually daily quarterly'.split(' '),
]);

/**
 * Whether an amount is describing whatever comes next, rather than standing on its own.
 *
 * Punctuation and the end of the script both answer no, which is the ordinary case and the one that
 * has to be right: "Down from $349.99." is an amount and then a full stop, and a reading of "349.99
 * dollar." would be wrong in the most audible place there is. See {@link NOT_A_THING_MONEY_BUYS}.
 */
function modifiesWhatFollows(rest: string): boolean {
    const next = /^\s+(\p{L}[\p{L}'’-]*)/u.exec(rest);
    if (next === null) return false;

    return !NOT_A_THING_MONEY_BUYS.has((next[1] as string).toLowerCase());
}

/** Small integers as words. Enough for a year's halves, an ordinal and a clock face. */
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'] as const;
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'] as const;
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const;
const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'] as const;
const TEEN_ORDINALS = [
    'tenth',
    'eleventh',
    'twelfth',
    'thirteenth',
    'fourteenth',
    'fifteenth',
    'sixteenth',
    'seventeenth',
    'eighteenth',
    'nineteenth',
] as const;
const TEN_ORDINALS = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'] as const;

/** The decades, by their tens digit. `00` and `10` are the two a station says as a pair of words. */
const DECADES: Record<string, string> = {
    '00': 'two thousands',
    '10': 'twenty tens',
    '20': 'twenties',
    '30': 'thirties',
    '40': 'forties',
    '50': 'fifties',
    '60': 'sixties',
    '70': 'seventies',
    '80': 'eighties',
    '90': 'nineties',
};

/** 0–99 as words. Anything outside that is not this file's business. */
function twoDigitWords(value: number): string {
    if (value < 10) return ONES[value]!;
    if (value < 20) return TEENS[value - 10]!;

    const ones = value % 10;
    return ones === 0 ? TENS[Math.floor(value / 10)]! : `${TENS[Math.floor(value / 10)]!}-${ONES[ones]!}`;
}

/** 1st–99th as words, and `undefined` for anything past that. */
function ordinalWords(value: number): string | undefined {
    if (value < 10) return ORDINALS[value];
    if (value < 20) return TEEN_ORDINALS[value - 10];
    if (value > 99) return undefined;

    const ones = value % 10;
    return ones === 0 ? TEN_ORDINALS[Math.floor(value / 10)] : `${TENS[Math.floor(value / 10)]!}-${ORDINALS[ones]!}`;
}

/**
 * A year as a person says it.
 *
 * Which is not as a number: nobody reads 1984 as one thousand nine hundred and eighty-four, and an
 * engine that does is the single most obvious sign the station is a machine. The four shapes are the
 * four a listener expects — the century mark, the two-thousands, the twenty-somethings, and the pair
 * of halves everything else is read as.
 */
function yearWords(value: number): string {
    const century = Math.floor(value / 100);
    const rest = value % 100;

    if (rest === 0) return `${twoDigitWords(century)} hundred`;
    if (value >= 2000 && value <= 2009) return `two thousand and ${ONES[rest]!}`;
    if (value >= 2010 && value < 2100) return `twenty ${twoDigitWords(rest)}`;
    if (rest < 10) return `${twoDigitWords(century)} oh ${ONES[rest]!}`;

    return `${twoDigitWords(century)} ${twoDigitWords(rest)}`;
}

/**
 * The numbers an engine reliably gets wrong, and only those.
 *
 * A year, a decade, an ordinal, a clock time and the two idioms that are not really numbers at all.
 * A plain integer is left alone deliberately: engines say "forty" for `40` perfectly well, while a
 * pass keen enough to catch every digit turns `99 Luftballons` and `Blink-182` into a different wrong
 * answer — and the second sort of wrong is worse, because it is the station mangling a name it was
 * given correctly.
 *
 * Order matters inside here too. The decade forms are taken before the bare year, or `1980s` would
 * become "nineteen eighty" with an `s` hanging off it.
 */
function sayNumbers(text: string): string {
    return (
        text
            // `24/7`, which is neither a date nor a fraction.
            .replace(/\b24\s*\/\s*7\b/g, 'twenty-four seven')
            // A clock face. `:00` is the one that is not a number at all.
            .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_match, hours: string, minutes: string) => {
                const hour = twoDigitWords(Number(hours));
                if (minutes === '00') return `${hour} o'clock`;
                return Number(minutes) < 10 ? `${hour} oh ${ONES[Number(minutes)]!}` : `${hour} ${twoDigitWords(Number(minutes))}`;
            })
            // `1980s`, `1980's`, `'80s`, `80s`. The apostrophe form is why this runs on tidied text,
            // where a typographic apostrophe is already a plain one.
            .replace(/\b(1[0-9]|20)(\d0)'?s\b/g, (match, century: string, decade: string) => {
                const named = DECADES[decade];
                return named === undefined ? match : `${twoDigitWords(Number(century))} ${named}`;
            })
            .replace(/(?<![\p{L}\p{N}])'?([0-9]0)'?s(?![\p{L}\p{N}])/gu, (match, decade: string) => DECADES[decade] ?? match)
            // A year, and only in the range a station talks about. Not part of a longer run of digits
            // and not touching a letter, so a catalogue number and a model name are left alone — but a
            // full stop AFTER it is a sentence ending rather than a decimal point, which is why the
            // guard on each side is "a digit with a separator between", not "a separator".
            .replace(/(?<![\p{L}\p{N}])(?<!\d[.,:])(1\d{3}|20\d{2})(?![\p{L}\p{N}])(?![.,:]\d)/gu, (match, digits: string) => {
                const value = Number(digits);
                return value >= 1000 && value <= 2099 ? yearWords(value) : match;
            })
            // The figure after "number", which `saySymbols` has just made out of `No.` or `#`. A chart
            // position is the one plain integer worth saying, because it is the point of the sentence.
            .replace(/\bnumber (\d{1,2})\b/g, (_match, digits: string) => `number ${twoDigitWords(Number(digits))}`)
            // An ordinal, which every engine reads as a cardinal with two letters after it.
            .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, (match, digits: string) => ordinalWords(Number(digits)) ?? match)
    );
}

/**
 * The initialisms a station says constantly, and the dotted ones whatever they are.
 *
 * Dotted first and unconditionally: `M.I.A.` is a spelling instruction from whoever wrote it, so it
 * needs no list. The list underneath is short on purpose and every entry is a word this station will
 * say in an ordinary hour. It is matched case-SENSITIVELY, because `US` and `us` are two different
 * things and only one of them is a country.
 */
function sayInitialisms(text: string): string {
    return text
        .replace(/(?<![\p{L}\p{N}])((?:[A-Za-z]\.){2,})(?![\p{L}\p{N}])/gu, (_match, dotted: string) =>
            dotted.replace(/\./g, ' ').trim().toUpperCase().split(/\s+/).join(' '),
        )
        .replace(/(?<![\p{L}\p{N}])(BBC|NPR|DJs|DJ|EP|LP|UK|USA|US|UN|TV|CD|FM|MC|NYC)(?![\p{L}\p{N}])/gu, match => {
            // The plural keeps its `s` as a word of its own, so `DJs` reads as the letters and then
            // the sound rather than as a three-letter initialism ending in something silent.
            const plural = match.endsWith('s');
            const letters = (plural ? match.slice(0, -1) : match).split('').join(' ');
            return plural ? `${letters}'s` : letters;
        });
}

/**
 * What the passes above left, as one line an engine can read.
 *
 * Two rules here rather than one drop-list, and the difference is audible: a character that SEPARATED
 * two words becomes a space, and one that was decoration is removed. Dropping a slash joins
 * "either/or" into one nonsense word, which is a new mispronunciation introduced by the thing meant
 * to prevent them.
 */
function settle(text: string): string {
    return (
        text
            // One pattern rather than two replaces, so the plural can never be matched as the singular
            // followed by a stray `S#`. Which one was written is `saySymbols`' reading of the sentence;
            // see `modifiesWhatFollows`.
            .replace(/#DOLLARS?#/g, marker => (marker === '#DOLLARS#' ? ' dollars' : ' dollar'))
            // Separators.
            .replace(/[/\\|~]+/g, ' ')
            // Decoration, including the symbols the passes above have already had their say about,
            // with a performance cue spared by name. One alternation rather than a drop followed by
            // a repair, because every repair needs a sentinel and every sentinel made of these
            // characters is itself in the drop-list: parking `[laugh]` as `#CUELAUGH#` leaves
            // `CUELAUGH` once the hashes go, and putting the brackets back around a bare `CUE(\w+)`
            // then turns the word RESCUED into `RES[d]`. Matching what to KEEP has no such gap.
            //
            // Whether the engine can perform one is settled before this runs: `SpeechService.sayable`
            // has already removed every cue the chosen plugin did not claim, so anything still here
            // is going to an engine that asked for it. See `SPEECH_CUES`.
            // The capture is what says WHICH alternative fired, and testing the match text instead is
            // the trap: a lone `[` is decoration, matches the character class, and starts with the
            // same character a cue does.
            .replace(SPARE_CUES, (_match, cue: string | undefined) => (cue === undefined ? '' : `[${cue.toLowerCase()}]`))
            .replace(/\s+/g, ' ')
            // A space that a removal left in front of its punctuation.
            .replace(/\s+([.,!?;:])/g, '$1')
            .trim()
    );
}
