import type { Topic } from '#modules/topics/topic.js';

/**
 * Which of the operator's categories a story belongs to.
 *
 * Pure, and table-tested, for `clock.bands.ts`'s reason: everything here is a decision about words
 * and nothing about it needs a database or a plugin. It is also the one piece of this feature that
 * runs on the floor as well as under the model — the deterministic bulletin reads categorised
 * stories exactly as the model binding does — so it may not fail, may not fetch, and may not need a
 * model to work.
 *
 * ## Three signals, ranked, and the ranking is the design
 *
 * A FEED is a decision somebody already made and is the only signal that cannot be wrong: a
 * publisher's technology feed is technology, whatever any particular headline says. A publisher's
 * own LABEL is nearly as good and is what most feeds actually carry. A WORD in the headline is the
 * weakest by a distance — "chip" is a semiconductor in one story and a shop in the next — so it
 * exists to catch what the first two miss and never to define a category.
 *
 * ## The first signal is stated on the FEED, not on the category
 *
 * A category used to name the feeds that were always it, as a list of `pluginId:feedId` typed in by
 * hand on the subjects page — an id derived from a name the operator wrote in a different form, for
 * a feed they were not looking at. The feed says it itself now (a row on the plugin that offers it,
 * carrying the category), and this matches that word against the category's own key or label. One
 * relationship, stated on the side that is looking at the thing, and an id nobody has to know.
 *
 * The rank is kept on the match rather than collapsed to a boolean because the bulletin uses it:
 * asked for technology, it reads the definite matches before the guesses.
 *
 * ## A story may belong to several, and that is not a failure to decide
 *
 * A satellite launch is technology and science, and the question this answers is "may this story be
 * read in the technology bulletin", not "what is this story really about". Forcing one answer would
 * mean inventing a precedence between the operator's own categories, which is a judgement nothing
 * here is in a position to make.
 *
 * ## Nothing here reads a model
 *
 * Deliberate, and the alternative was considered: a model can tell US news from world news better
 * than any keyword list. It would also be a second model caller inside a bulletin's own deadline,
 * on the one gate slot, in the one kind of break where being slow costs the slot — see `LlmGate`.
 * The rules are the floor; if a model ever labels stories it should write into the same shape.
 */

/** How sure a match is, in the order the bulletin should read them. */
export type MatchRank = 'feed' | 'label' | 'word';

const RANKS: Record<MatchRank, number> = { feed: 3, label: 2, word: 1 };

/** One category, as the classifier reads it: the row's `config` parsed once. */
export interface NewsTopicRules {
    key: string;
    label: string;
    /**
     * What a feed may call this category to BE it, normalized: its key and its label.
     *
     * Both, because a category is written once and named twice — an operator picking `Sport` off a
     * list is choosing the key, and one typing into a plugin that could not offer the list writes
     * whatever they would call it. Matching only one of the two would make a feed's category work
     * or not work depending on which form the operator happened to have in front of them.
     */
    names: string[];
    /** The publishers' own labels for it, normalized. Matched whole. */
    labels: string[];
    /** Words that mean it, normalized. Matched as whole words against the headline and teaser. */
    words: string[];
}

/** As much of a story as the classifier looks at. */
export interface ClassifiableStory {
    /**
     * The category the FEED this story came from declares itself to be, in the operator's own word.
     *
     * Not the story's own claim about itself: the feed's, which is why it outranks everything else
     * here. Absent for a feed nobody has categorised, which is the ordinary state and simply leaves
     * the story to be judged on what it says.
     */
    feedCategory?: string;
    title?: string;
    summary?: string;
    /** The publisher's own labels, unmapped and in their own spelling. */
    categories?: readonly string[];
}

/**
 * A category row as rules.
 *
 * Read off `config` defensively, because that column is edited through a form and by hand: anything
 * that is not a list of words is an empty list, which makes the category match nothing rather than
 * making a bulletin throw on its way to air. An unfinished category and a broken one behave the
 * same, and the bulletin's decline says so either way.
 */
export function newsTopicRules(topic: Topic): NewsTopicRules {
    return {
        key: topic.key,
        label: topic.label,
        // Off the ROW rather than out of `config`, because this is what the category IS rather than
        // something written into it: a category the operator has not finished still answers to its
        // own name.
        names: [...new Set([normalize(topic.key), normalize(topic.label)])].filter(entry => entry.length > 0),
        labels: entriesIn(topic.config.labels)
            .map(normalize)
            .filter(entry => entry.length > 0),
        words: entriesIn(topic.config.words)
            .map(normalize)
            .filter(entry => entry.length > 0),
    };
}

/**
 * How well this story fits this category, or `undefined` for not at all.
 *
 * The strongest signal wins rather than the sum of them: two weak words are not a stronger claim
 * than a publisher's own label, and adding them up would let a category with a long word list beat
 * one with a feed named in it.
 */
export function rankOf(story: ClassifiableStory, rules: NewsTopicRules): MatchRank | undefined {
    // Normalized on both sides, so `US news` typed on a feed and the `us` category the station
    // holds are the same answer. See `normalize`.
    if (story.feedCategory !== undefined && rules.names.includes(normalize(story.feedCategory))) return 'feed';

    const labels = (story.categories ?? []).map(normalize);
    if (labels.some(label => rules.labels.includes(label))) return 'label';

    // The headline and the teaser, which is everything a listener would hear or nearly hear. The
    // article body is deliberately not searched: it is long enough that any word list matches
    // eventually, which would make every category match every story.
    const said = normalize(`${story.title ?? ''} ${story.summary ?? ''}`);
    if (rules.words.some(word => saysWord(said, word))) return 'word';

    return undefined;
}

/** Every category this story belongs to, strongest first. */
export function categoriesOf(story: ClassifiableStory, rules: readonly NewsTopicRules[]): { key: string; rank: MatchRank }[] {
    return rules
        .flatMap(rule => {
            const rank = rankOf(story, rule);
            return rank === undefined ? [] : [{ key: rule.key, rank }];
        })
        .sort((left, right) => RANKS[right.rank] - RANKS[left.rank]);
}

/**
 * A field that may have been written as lines, as a comma list, or as a real array.
 *
 * All three, because all three happen: the console writes an array, a `text` field an operator
 * typed into is lines, and somebody editing the row by hand writes whichever they think of. Guessing
 * between them is safe in a way guessing at a clock band is not — the worst outcome is a category
 * that matches less than intended, which shows up as a bulletin declining rather than as the wrong
 * thing going out.
 */
function entriesIn(value: unknown): string[] {
    const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,]/) : [];

    return parts.flatMap(part => (typeof part === 'string' && part.trim().length > 0 ? [part.trim()] : []));
}

/**
 * Lowercase, unaccented, punctuation to spaces, so two spellings of one label are one label.
 *
 * Full stops and apostrophes are DROPPED rather than turned into spaces, which the other
 * punctuation is. That is the difference between `U.S. news` and `US News` being one label and
 * being two — an operator writing the first and a publisher tagging the second is the ordinary case
 * — and between `world's` and `worlds` matching each other. A hyphen still becomes a space, because
 * `app-store` and `app store` are the same two words rather than one.
 */
const normalize = (value: string): string =>
    value
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[.'’]/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

/**
 * Whether a normalized text says a normalized word, as a WHOLE word.
 *
 * A substring test would have `ai` match "said" and "chain", which on a station whose technology
 * category names `ai` is every second story. The phrase case is why this is a spaces-padded
 * `includes` rather than a regular expression: an entry may be several words ("app store"), and
 * building a pattern per entry per story is work for no gain.
 */
const saysWord = (said: string, word: string): boolean => ` ${said} `.includes(` ${word} `);
