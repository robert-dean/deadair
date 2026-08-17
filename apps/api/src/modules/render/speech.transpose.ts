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

import { applyPronunciations, type Pronunciation } from './pronunciation.lexicon.js';

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

    let spoken = tidy(original);
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
 * talks in another currency has a list to fix it in.
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
            // The whole figure, not its first digit: `$5.99` is one amount and the word goes after
            // all of it. The marker survives {@link settle}'s drop-list and becomes the word there.
            .replace(/\$(\d[\d,]*(?:\.\d+)?)/g, '$1#DOLLARS#')
            .replace(/&/g, ' and ')
            .replace(/\s@\s/g, ' at ')
            .replace(/%/g, ' percent')
            .replace(/(\d)\s*\+/g, '$1 plus')
    );
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
            .replace(/#DOLLARS#/g, ' dollars')
            // Separators.
            .replace(/[/\\|~]+/g, ' ')
            // Decoration, including the symbols the passes above have already had their say about.
            .replace(/[*_`^<>{}[\]=+@#&$%]/g, '')
            .replace(/\s+/g, ' ')
            // A space that a removal left in front of its punctuation.
            .replace(/\s+([.,!?;:])/g, '$1')
            .trim()
    );
}
