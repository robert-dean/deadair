/**
 * What a news story is ABOUT, as a set of tokens two wordings of it share.
 *
 * ## Why a headline is not enough
 *
 * `ReadLog` and `distinct` key a story on its headline, which catches one story carried by two
 * feeds under one headline and nothing else. Two newsrooms covering one event almost never agree on
 * the headline: measured on the station's own roster on 2026-11-07, the BBC's "Cornell faculty pass
 * no-confidence vote over leadership's handling of Jane Doe allegations" and PBS's "Cornell faculty
 * vote 'no confidence' in university leadership after alleged fraternity gang rape" were the same
 * vote, a few minutes apart in one window, and to the station two stories it had not read.
 *
 * ## What a signature holds
 *
 * The distinctive tokens of the headline, the teaser and the opening of the story: every content
 * word (folded, lightly stemmed, stopwords and years out), which of those the text writes as a NAME,
 * and any vulnerability identifier. JSON-safe on purpose, because the read log keeps one in Redis.
 *
 * ## Why rarity decides, and why it is measured in the window
 *
 * A token says which story this is only if few stories carry it. "Trump" or "AI" turns up in a
 * third of a day's window and says nothing; "Cornell" turns up in two and says nearly everything.
 * So {@link StoryRarity} counts, over the stories the bulletin was actually offered, how many carry
 * each token, and only a rare one counts as evidence. It costs nothing, because the pages are
 * already in hand.
 *
 * ## The rule, applied by code rather than judged
 *
 * Two stories are one when they share a rare identifier, or two rare names, or one rare name and
 * three more rare words. Set against the 2026-11-07 window (sixty stories, sixteen feeds): it joins
 * exactly the three pairs a listener would call one story (the Cornell vote, the Pope's trip to
 * Uruguay, Stephen Miller's appointment) and none of the near-misses, of which the closest were two
 * different data-centre stories and two different stories about AI stocks. The nearest wrong pair
 * held one rare name and two rare words, so the bar has one word of margin and no more. A miss
 * costs a listener a story twice, which is what happened before this; a wrong match costs a story
 * the bulletin reaches past, so the bar is set conservatively, and {@link sameStory} answers with
 * its evidence so a match can be logged and checked.
 *
 * ## Language
 *
 * The stopword list is English, which matters less than it looks: a common word in any language is
 * common in the window and never rare. Names are the part that depends on the language, because a
 * name is a word written with a capital mid-sentence, and German capitalises every noun. For those
 * languages {@link signatureOf} records no names, and only an identifier joins two stories.
 */

/** One story's distinctive tokens. Plain arrays, so it is JSON-safe and can be stored as it is. */
export interface StorySignature {
    /** Every distinctive token, names and identifiers included. */
    readonly tokens: readonly string[];
    /**
     * The names the text writes, each as its tokens joined by a space: "stephen miller", "justice department".
     *
     * A PHRASE rather than a token, because a two-word name is one name: counted word by word,
     * "White House" or "Supreme Court" joined two unrelated stories on its own. Every token in one is
     * also in {@link tokens}.
     */
    readonly names: readonly string[];
    /** Vulnerability identifiers, which identify a story on their own. A subset of {@link tokens}. */
    readonly ids: readonly string[];
}

/** Why {@link sameStory} called two stories one, for a log line somebody can check. */
export interface SameStoryEvidence {
    readonly ids: readonly string[];
    readonly names: readonly string[];
    readonly words: readonly string[];
}

/** How much of the story's own text is read after its headline and teaser. Its opening, not its quotes. */
export const OPENING_CHARS = 400;

/**
 * A token carried by more stories than this in the window is not rare.
 *
 * Four because one story is rarely carried by more than four newsrooms (a wire, two broadcasters and
 * a paper), and a token every copy of it shares has to stay evidence. Fixed rather than a share of
 * the window: at five per cent, a two-day window of 136 stories let a name seven stories carried
 * count as rare, and "Justice Department" joined three different stories about it.
 */
export const RARE_CEILING = 4;

/** Rare names that join two stories on their own. */
export const NAMES_ALONE = 2;

/**
 * Rare words that join two stories when they also share one rare name.
 *
 * Four rather than three because of a measured wrong match: two stories about Elon Musk's companies
 * (the Cybertruck ending, Starlink's phone ambitions) shared his name and "next", "plan" and
 * "building". The true one-name pair in the same window, the Cornell vote, shared seven.
 */
export const WORDS_WITH_A_NAME = 4;

/**
 * Languages that capitalise every noun, where a capital mid-sentence is not a name.
 *
 * Primary subtags, matched against `stationLanguage`'s lower-cased tag.
 */
const NOUN_CAPITALISING = new Set(['de', 'lb', 'gsw']);

/** Words that carry no story, in English. A common word in any other language is never rare anyway. */
const STOPWORDS = new Set(
    `a an the and or but of to in on at for with from by as is are was were be been being it its this that these those
    he she they them his her their our we you your i not no nor so than then there here what which who whom whose when
    where why how all any both each few more most other some such only own same too very can will just should now after
    before over under about into out up down off again further once also says said say new news week year years day days
    today yesterday tomorrow monday tuesday wednesday thursday friday saturday sunday january february march april may june
    july august september october november december could would might must has have had do does did get gets got make makes
    made know report reports amid while still first last one two three four five six seven eight nine ten`
        .split(/\s+/)
        .filter(word => word.length > 0),
);

/** A word, keeping the apostrophes, dots and hyphens inside one ("U.S.", "no-confidence", "Leo's"). */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu;

const CVE = /^cve-\d{4}-\d{4,}$/;

/**
 * The signature of one story, from its headline, teaser and the opening of its text.
 *
 * `names: false` is a station whose language capitalises nouns; see the file's note on language.
 */
export function signatureOf(
    story: { readonly headline: string; readonly summary?: string; readonly body?: string },
    options: { readonly names?: boolean } = {},
): StorySignature {
    // The headline taken out of the text wherever the text repeats it: a WordPress teaser reads "The
    // post <headline> appeared first on <site>", and a Title Case headline inside it made every one
    // of its words a name.
    const text = withoutHeadline([story.summary ?? '', (story.body ?? '').slice(0, OPENING_CHARS)].join(' '), story.headline);
    const all = `${story.headline} ${text}`;

    const tokens = new Set<string>();
    const ids = new Set<string>();
    for (const [word] of all.matchAll(WORD)) {
        const token = tokenOf(word);
        if (token === undefined) continue;
        tokens.add(token);
        if (CVE.test(token)) ids.add(token);
    }

    const names = options.names === false ? new Set<string>() : namesIn(story.headline, text, tokens);
    return { tokens: [...tokens], names: [...names], ids: [...ids] };
}

/** Whether a station broadcasting in `language` (a `stationLanguage` tag, `undefined` for English) can read names. */
export function readsNames(language: string | undefined): boolean {
    if (language === undefined) return true;
    return !NOUN_CAPITALISING.has(language.split('-')[0] ?? language);
}

/**
 * How many stories in a window carry each token, which is what makes a token evidence.
 *
 * Built from the stories a bulletin was OFFERED, which is the day's news as this station's feeds see
 * it. A token the window never saw is rare by definition.
 */
export class StoryRarity {
    private readonly carriedBy = new Map<string, number>();

    constructor(window: readonly StorySignature[]) {
        for (const signature of window) {
            for (const token of signature.tokens) this.carriedBy.set(token, (this.carriedBy.get(token) ?? 0) + 1);
        }
    }

    /** Whether few enough stories in the window carry this token for it to say which story this is. */
    isRare(token: string): boolean {
        return (this.carriedBy.get(token) ?? 0) <= RARE_CEILING;
    }
}

/**
 * Whether two stories are one, and on what evidence, or `undefined` when they are two.
 *
 * Symmetric. A token counts as a name when either story writes it as one, because one publisher's
 * Title Case headline and another's teaser are the same name in two house styles.
 */
export function sameStory(a: StorySignature, b: StorySignature, rarity: StoryRarity): SameStoryEvidence | undefined {
    const overlap = storyOverlap(a, b, rarity);
    return joins(overlap) ? overlap : undefined;
}

/** Whether this much shared evidence makes two stories one. The whole of the rule, in one place. */
export function joins(overlap: SameStoryEvidence): boolean {
    return overlap.ids.length > 0 || overlap.names.length >= NAMES_ALONE || (overlap.names.length >= 1 && overlap.words.length >= WORDS_WITH_A_NAME);
}

/** The rare evidence two stories share, whether or not it is enough. See {@link sameStory}. */
export function storyOverlap(a: StorySignature, b: StorySignature, rarity: StoryRarity): SameStoryEvidence {
    const inB = new Set(b.tokens);
    const identifiers = new Set([...a.ids, ...b.ids]);
    const shared = a.tokens.filter(token => inB.has(token) && rarity.isRare(token));
    const named = new Set([...a.names, ...b.names].flatMap(name => name.split(' ')));

    const ids = shared.filter(token => identifiers.has(token));
    const words = shared.filter(token => !identifiers.has(token) && !named.has(token));
    const nameTokens = new Set(shared.filter(token => !identifiers.has(token) && named.has(token)));

    // Counted as NAMES, not as words: "Stephen Miller" and "Susie Wiles" are two, "Justice
    // Department" is one. Each story counts the names of its own that a shared rare token is part of,
    // and the smaller count holds, so "Pope Leo XIV" against "Pope Leo … Uruguay" is two (the pope and
    // Uruguay) rather than three. A story that writes none of them as a name (it only ever opens a
    // sentence with "Cornell") defers to the other, which did.
    const namesIn = (signature: StorySignature): string[] =>
        distinctNames(
            signature.names.filter(name => name.split(' ').some(token => nameTokens.has(token))),
            nameTokens,
        );
    const counted = [namesIn(a), namesIn(b)].filter(names => names.length > 0);
    const names =
        counted.reduce<string[] | undefined>((fewest, own) => (fewest === undefined || own.length < fewest.length ? own : fewest), undefined) ?? [];

    return { ids, names, words };
}

/**
 * One entry per NAME among these, where two that share a token are one: "Cornell" and "Cornell
 * University", or "Figures" and "Shomari Figures", are one name written two ways, and counted as two
 * they joined a lawsuit to an unrelated faculty vote. The longest spelling is the one kept.
 */
function distinctNames(names: readonly string[], shared: ReadonlySet<string>): string[] {
    const kept: { name: string; tokens: Set<string> }[] = [];
    for (const name of [...names].sort((x, y) => y.length - x.length)) {
        const tokens = new Set(name.split(' ').filter(token => shared.has(token)));
        const same = kept.find(entry => [...tokens].some(token => entry.tokens.has(token)));
        if (same === undefined) kept.push({ name, tokens });
        else for (const token of tokens) same.tokens.add(token);
    }
    return kept.map(entry => entry.name);
}

/** One word as a token: folded, lightly stemmed, or nothing when it carries no story. */
function tokenOf(word: string): string | undefined {
    const folded = fold(word).replace(/\.+$/u, '');
    if (CVE.test(folded)) return folded;
    if (/^\d+$/u.test(folded)) {
        // A one-digit figure is in every story; a year is in every story that year.
        const value = Number(folded);
        if (folded.length < 2 || (value >= 1900 && value <= 2100)) return undefined;
        return folded;
    }
    if (folded.length < 3 || STOPWORDS.has(folded)) return undefined;
    const stemmed = stem(folded);
    return STOPWORDS.has(stemmed) ? undefined : stemmed;
}

/** Lower case, accents off, curly apostrophes straightened. */
function fold(word: string): string {
    return word
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/’/gu, "'")
        .toLowerCase();
}

/**
 * Enough stemming that "stocks" meets "stock" and "Leo's" meets "Leo", and no more.
 *
 * A real stemmer would join "university" and "universal", which is the kind of match this file
 * must never make; a plural and a possessive are the two forms one story's two wordings differ by.
 */
function stem(word: string): string {
    const bare = word.endsWith("'s") ? word.slice(0, -2) : word;
    if (bare.length > 4 && bare.endsWith('ies')) return `${bare.slice(0, -3)}y`;
    if (bare.length > 4 && bare.endsWith('s') && !bare.endsWith('ss')) return bare.slice(0, -1);
    return bare;
}

/**
 * The tokens this story writes as names: capitalised somewhere other than the start of a sentence,
 * and never written in lower case.
 *
 * A Title Case headline capitalises every word, so its capitals are read only when the headline is
 * written as a sentence. The teaser and the story are always read: "Pope Leo travels to Uruguay".
 */
function namesIn(headline: string, text: string, tokens: ReadonlySet<string>): Set<string> {
    const sources = titleCased(headline) ? [text] : [headline, text];
    const lower = new Set<string>();
    for (const source of [headline, text]) {
        for (const [word] of source.matchAll(WORD)) if (/^\p{Ll}/u.test(word)) lower.add(tokenOf(word) ?? '');
    }

    // A run of capitalised words with nothing but a space between them is one name. A word opening
    // a sentence is not a name on its own evidence, but it does not break a run either: "Pope Leo
    // travels" opens on the name it is part of.
    const names = new Set<string>();
    for (const source of sources) {
        let run: string[] = [];
        let end = -1;
        let named = false;
        const close = (): void => {
            if (named && run.length > 0) names.add(run.join(' '));
            run = [];
            named = false;
        };
        for (const match of source.matchAll(WORD)) {
            const capitalised = /^\p{Lu}/u.test(match[0]);
            const token = capitalised ? tokenOf(match[0]) : undefined;
            const adjacent = end >= 0 && /^\s+$/u.test(source.slice(end, match.index));
            if (!adjacent || token === undefined || !tokens.has(token) || lower.has(token)) close();
            end = match.index + match[0].length;
            if (token === undefined || !tokens.has(token) || lower.has(token)) continue;
            run.push(token);
            if (!opensSentence(source, match.index)) named = true;
        }
        close();
    }
    return names;
}

/** The text with every occurrence of the headline taken out, ignoring case. */
function withoutHeadline(text: string, headline: string): string {
    const trimmed = headline.trim();
    if (trimmed.length === 0) return text;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return text.replace(new RegExp(escaped, 'giu'), ' ');
}

/** A headline that capitalises every long word after the first, so its capitals say nothing. */
function titleCased(headline: string): boolean {
    const long = [...headline.matchAll(WORD)].slice(1).filter(([word]) => word.length >= 4);
    return long.length >= 3 && long.every(([word]) => /^\p{Lu}/u.test(word));
}

/** Whether the word at `offset` opens a sentence (or the clause after a colon). */
function opensSentence(text: string, offset: number): boolean {
    return /(^|[.!?:]\s+)["'‘“(]?$/u.test(text.slice(0, offset));
}
