/**
 * The pronunciation key an article printed for itself, read back out.
 *
 * An encyclopaedia's opening line frequently says how the name is said — "Lynyrd Skynyrd ( LEH-nerd
 * SKIN-nerd)", "112 (pronounced "one-twelve")" — and the station already holds those articles,
 * because a plugin handed them over for the fact store. So the lexicon can be filled from prose
 * nobody has to write, with the sentence it came from attached.
 *
 * Pure, and tested against every gloss the live catalogue actually contains, because nothing checks
 * these afterwards: a wrong entry is a name said wrongly on every break that ever mentions it.
 *
 * ## Only the respelling forms, deliberately
 *
 * Measured over 539 stored articles: 34 carry a bare respelling and 9 the quoted form, both of which
 * a speech engine can read as they stand. TWO carry IPA, which it cannot, and there is no honest
 * conversion — so an IPA gloss is left alone rather than mangled into something that sounds
 * confident. Searching for `/…/` was tried and abandoned: it matches 86 documents and every one of
 * them is `CD/DVD/Blu-ray`, `June 16/17/18`, or a genre list.
 *
 * ## A gloss is not automatically about the name it sits beside
 *
 * This is the whole difficulty, and it is why {@link readGloss} answers with a CONFIDENCE rather
 * than an entry. `Madonna ( chih-KOH-nee)` is about Ciccone. `Stevie Wonder ( STEEV-lənd)` is about
 * Steveland. `Kanye West ( YAY)` is about a renaming. Roughly half gloss one word of two, and it is
 * not reliably the surname: `Aretha Franklin ( ə-REE-thə)` glosses the first name.
 *
 * So the written side is chosen by RESEMBLANCE rather than by position — which word of the name does
 * this gloss sound like? — and a gloss that resembles nothing is proposed and never applied.
 * {@link CONFIDENCE_BAR} is a measured number: over the 34 real samples it is the middle of the
 * plateau where 27 map correctly with none wrong, and the fixture in `pronunciation.gloss.test.ts`
 * is the record of that. Moving it means moving them.
 */

/**
 * How much the gloss has to sound like the name before the station says it unasked.
 *
 * At 0.5, `Stevie Wonder ( STEEV-lənd)` maps to `Stevie` and goes on air. At 0.7, seven correct
 * entries wait for an operator who has nothing to add to them. Between 0.55 and 0.65 nothing is
 * wrong, so it is set in the middle of that rather than at either edge.
 */
export const CONFIDENCE_BAR = 0.6;

/** How much of an article can hold the pronunciation key. It is in the opening line or nowhere. */
const LEAD_WINDOW = 400;

/** What one article says about how to say one name. */
export interface GlossReading {
    /** The word or words this is about, which is the whole name or one word of it. */
    written: string;
    /** What to hand the engine. Never empty: a gloss saying nothing is not a gloss. */
    spoken: string;
    /** The sentence as it stands in the article, which is what an operator judges the entry on. */
    sourceQuote: string;
    /** Whether the station may say it without being asked. See {@link CONFIDENCE_BAR}. */
    confident: boolean;
}

/**
 * Wikipedia's rendered pronunciation key: a parenthetical opening on whitespace.
 *
 * The leading space is an artefact of the template rather than anything a sentence does, and it is
 * half of what tells this from an ordinary parenthesis of prose. `fact.lead.ts` strips the same
 * construction out of a claim with the same pair of signals, and the two want to stay in step.
 */
const BARE = /\(\s([^()]*)\)/;

/** The form that announces itself, which is the minority and the easy one. */
const QUOTED = /\(pronounced\s+["“]([^"”]+)["”]\)/i;

/** What a respelling may be made of, before the schwa is spelled out. */
const RESPELLING = /^[\p{L}\p{M}\s'’.-]+$/u;

/** What it may be made of afterwards, which is what a speech engine can actually read. */
const SPEAKABLE = /^[A-Za-z\s'’.-]+$/;

/**
 * What one article says about how to say one name, or nothing.
 *
 * `name` is the catalogue's own — an artist, an album or a track title — and is what the entry is
 * measured against. Answers `undefined` for the ordinary case, which is an article that says nothing
 * about pronunciation at all.
 */
export function readGloss(name: string, text: string): GlossReading | undefined {
    const window = text.slice(0, LEAD_WINDOW);
    const found = firstGloss(window);
    if (found === undefined) return undefined;

    const spoken = speakableForm(found.gloss);
    if (spoken === undefined) return undefined;

    const subject = plainName(name);
    if (subject.length === 0) return undefined;

    const chosen = whatItIsAbout(subject, found.gloss);

    // A gloss the article introduced with the word "pronounced" is a CLAIM about the name it
    // follows, so it needs no resemblance test as long as it covers the whole name. That is what
    // lets `112 (pronounced "one-twelve")` through — a name resemblance cannot judge at all, since
    // it has no letters, and exactly the sort of name a lexicon exists for.
    //
    // It is deliberately not a blanket trust. A declared gloss that came out as being about ONE word
    // of the name is judged like any other, because WHICH word is still an inference and the article
    // said nothing about that.
    if (found.declared && (chosen === undefined || chosen.written === subject)) {
        return { written: subject, spoken, sourceQuote: sentenceAround(text, found.at), confident: true };
    }

    if (chosen === undefined) return undefined;

    return {
        written: chosen.written,
        spoken,
        sourceQuote: sentenceAround(text, found.at),
        confident: chosen.score >= CONFIDENCE_BAR,
    };
}

/**
 * A catalogue name as the name itself, without what the release was called.
 *
 * `2112 (Deluxe Edition)` is one record whose name is `2112`, and matching a gloss against the words
 * of the whole string picked `Edition)` as the thing being pronounced — a written form carrying a
 * bracket, which nothing in a script will ever match and which reads to an operator as a bug rather
 * than as a proposal. Dropping a trailing parenthetical is the same allowance `namedRecordIn` makes
 * when it checks whether a break named a record.
 */
const plainName = (name: string): string =>
    name
        .replace(/[([][^)\]]*[)\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

/** Whichever form comes first, since an article carries one or the other and never both. */
function firstGloss(window: string): { gloss: string; at: number; declared: boolean } | undefined {
    const quoted = QUOTED.exec(window);
    const bare = BARE.exec(window);

    // The bare form is checked for being one, because its two signals are what separate it from an
    // ordinary parenthesis. The quoted form said so itself.
    const bareGloss = bare === undefined || bare === null ? undefined : headOf(bare[1] ?? '');
    const usableBare = bareGloss !== undefined && isRespelling(bareGloss) ? { gloss: bareGloss, at: bare!.index, declared: false } : undefined;
    const usableQuoted = quoted === null ? undefined : { gloss: (quoted[1] ?? '').trim(), at: quoted.index, declared: true };

    if (usableBare === undefined) return usableQuoted;
    if (usableQuoted === undefined) return usableBare;

    return usableBare.at <= usableQuoted.at ? usableBare : usableQuoted;
}

/**
 * The respelling, without whatever else the lead crammed into the same brackets.
 *
 * A real one: `( ə-REE-thə; March 25, 1942 – August 16, 2018)`. The dates are not a pronunciation
 * and the semicolon is where the article itself said so.
 */
const headOf = (inside: string): string => (inside.split(/[;,]/)[0] ?? '').trim();

/** Whether a bare parenthetical is a respelling: letters and hyphens, carrying a stressed syllable. */
const isRespelling = (gloss: string): boolean => gloss.length > 0 && /\p{Lu}{2,}/u.test(gloss) && RESPELLING.test(gloss);

/**
 * The gloss as something an engine can read, or nothing.
 *
 * The schwa is the one substitution made here, and it has to be made: Wikipedia's respelling key
 * uses `ə` throughout and no speech engine has any idea what `lə-VEEN` is. The untouched original
 * still goes into the source quote, so the substitution is visible rather than silent.
 *
 * Anything still not plain letters afterwards is a phonetic notation rather than a respelling, and
 * is refused rather than passed on: a name said in IPA out loud is worse than a name said plainly.
 */
function speakableForm(gloss: string): string | undefined {
    const spoken = gloss.replace(/ə/g, 'uh').trim();

    return spoken.length > 0 && SPEAKABLE.test(spoken) ? spoken : undefined;
}

/**
 * Which words of the name this gloss is about, and how sure that is.
 *
 * Two shapes, and the count is what tells them apart. A gloss with as many parts as the name has
 * words is about the whole name; a shorter one is about ONE of its words, and which one is decided
 * by resemblance rather than by position, because the glossed word is as often the first as the
 * last. A longer one is a parse that went wrong and is dropped.
 */
function whatItIsAbout(name: string, gloss: string): { written: string; score: number } | undefined {
    const parts = gloss.split(/\s+/).filter(part => part.length > 0);
    const words = name
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 0);
    if (parts.length === 0 || words.length === 0 || parts.length > words.length) return undefined;

    if (parts.length === words.length) {
        // The weakest word decides. A two-word gloss where one half matches and the other is a
        // different name entirely is not a whole-name gloss, whatever the average says.
        const score = Math.min(...words.map((word, at) => resemblance(word, parts[at] ?? '')));
        return { written: name.trim(), score };
    }

    const ranked = words.map(word => ({ written: word, score: resemblance(word, gloss) })).sort((a, b) => b.score - a.score);
    return ranked[0];
}

/**
 * How much a respelling sounds like a word, between 0 and 1.
 *
 * Both sides are reduced to a consonant SKELETON first, which is what makes this work at all: a
 * respelling and a spelling disagree about vowels by design ("ə-REE-thə" against "Aretha") and agree
 * about consonants nearly always. The digraph folding underneath is crude and only has to be
 * consistent — it is applied to both sides, so it is a comparison rather than a transcription.
 */
export function resemblance(word: string, gloss: string): number {
    const a = skeleton(word);
    const b = skeleton(gloss);
    if (a.length === 0 || b.length === 0) return 0;

    return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

/** A word as the consonants it is made of, with the sounds one letter can spell folded together. */
function skeleton(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-zə]/g, '')
        .replace(/ə/g, 'a')
        .replace(/ee|ea|ie|ey|y$/g, 'i')
        .replace(/oo|ou/g, 'u')
        .replace(/oh|ow/g, 'o')
        .replace(/ai|ay|ae/g, 'a')
        .replace(/ck|kh|k/g, 'c')
        .replace(/ph|f/g, 'f')
        .replace(/sh|ch|j|zh/g, 'x')
        .replace(/g/g, 'c')
        .replace(/z|s/g, 's')
        .replace(/(.)\1+/g, '$1')
        .replace(/[aeiou]/g, '');
}

/** Levenshtein, on two strings that are never longer than a name. */
function editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, at) => at);

    for (let row = 1; row <= a.length; row++) {
        const current = [row];
        for (let column = 1; column <= b.length; column++) {
            current[column] = Math.min(
                (previous[column] ?? 0) + 1,
                (current[column - 1] ?? 0) + 1,
                (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
            );
        }
        previous = current;
    }

    return previous[b.length] ?? 0;
}

/**
 * The sentence the gloss is in, as it stands.
 *
 * The quote is the evidence, so it is the article's own text and not the tidied version: an operator
 * deciding whether "chih-KOH-nee" is how to say "Madonna" needs the sentence it was lifted out of.
 */
function sentenceAround(text: string, at: number): string {
    const from = text.lastIndexOf('. ', at);
    const start = from < 0 ? 0 : from + 2;

    const stop = text.indexOf('. ', at);
    const end = stop < 0 ? Math.min(text.length, start + LEAD_WINDOW) : stop + 1;

    return text.slice(start, end).trim();
}
