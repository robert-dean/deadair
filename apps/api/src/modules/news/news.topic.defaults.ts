import type { TopicDraft } from '#modules/topics/topic.js';
import { NEWS_KIND } from '#modules/director/news.break.writer.js';

/**
 * The news categories a fresh install already knows about.
 *
 * ## Seeds, not built-ins
 *
 * Nothing resolves a category through this list — `persona.defaults.ts`'s rule, and the same
 * consequence: they are copied into `deadair.topics` on a station that has none and are ordinary
 * editable rows afterwards, so an operator who rewrites Technology has rewritten it, and one who
 * deletes Sport has deleted it. The guard is that the station holds NO news categories rather than
 * that each key is missing, which is what makes deleting a seeded one expressible.
 *
 * ## None of them names a FEED, and one ships with nothing at all
 *
 * Not because a feed would be the wrong thing to say — it is the strongest signal there is — but
 * because it is not said here at all: a feed states its own category, on the plugin that reads it,
 * against feeds only this operator has. The same reason no seeded persona names a voice. So these
 * are seeded with the publishers' own labels and a short word list, and a category becomes certain
 * the moment the operator has a feed worth pointing at it.
 *
 * `local` deliberately carries nothing. Only the operator knows their town, and a category with no
 * matchers is unfinished rather than broken: the bulletin declines the slot and says which category
 * it declined for, which is a state somebody can act on. Seeding it with a guess — a country, a
 * capital — would be worse than empty, because it would look as though it worked.
 *
 * ## One of them is a rule about what is never read
 *
 * `shopping` is seeded with its switch on, which makes it the one category here that withholds
 * stories rather than describing them. It is seeded because the failure is not exotic: a general
 * feed from a publisher with a deals desk mixes them in, and this station read a discount code and
 * an affiliate disclosure out as news. Its labels are the words publishers actually file that
 * material under, and a publisher's own name for its shopping desk is deliberately not among them —
 * only the operator knows which feeds they have, which is the same rule that keeps a feed out of
 * every other seed here.
 *
 * ## The word lists are short on purpose
 *
 * A word is the weakest of the three signals (`news.classify.ts`), and a long list is how a category
 * comes to match everything: "market" is business until a story about a farmers' market, "court" is
 * politics until a tennis result. These carry the words that are nearly unambiguous and leave the
 * rest to the publishers' own labels.
 */
export const NEWS_TOPIC_SEEDS: readonly TopicDraft[] = ordered([
    seed('world', 'World news', {
        labels: ['World', 'World news', 'International', 'Global'],
        words: ['united nations', 'nato', 'ceasefire', 'summit'],
    }),
    seed('us', 'US news', {
        labels: ['US', 'U.S.', 'US news', 'United States', 'National', 'America'],
        words: ['white house', 'congress', 'senate', 'supreme court', 'washington'],
    }),
    // Nothing at all, and that is the point. See the note above.
    seed('local', 'Local news', {}),
    seed('politics', 'Politics', {
        labels: ['Politics', 'Political', 'Elections'],
        words: ['election', 'parliament', 'minister', 'campaign', 'ballot'],
    }),
    seed('business', 'Business', {
        labels: ['Business', 'Economy', 'Finance', 'Markets', 'Money'],
        words: ['inflation', 'interest rates', 'earnings', 'takeover', 'bankruptcy'],
    }),
    seed('technology', 'Technology', {
        labels: ['Technology', 'Tech', 'Science and technology', 'Gadgets', 'Computing'],
        words: ['semiconductor', 'smartphone', 'software', 'cybersecurity', 'app store'],
    }),
    seed('science', 'Science', {
        labels: ['Science', 'Environment', 'Climate', 'Space'],
        words: ['researchers', 'telescope', 'spacecraft', 'emissions', 'fossil'],
    }),
    seed('health', 'Health', {
        labels: ['Health', 'Wellbeing', 'Medicine'],
        words: ['outbreak', 'vaccine', 'hospital', 'clinical trial'],
    }),
    seed('entertainment', 'Entertainment', {
        labels: ['Entertainment', 'Arts', 'Film', 'Television', 'Music', 'Culture'],
        words: ['box office', 'grammy', 'oscars', 'album', 'festival lineup'],
    }),
    // Its own category rather than a corner of entertainment, because they are different bulletins:
    // entertainment is what the industry did and this is what everybody is talking about, and a
    // station that wants one of them at teatime rarely wants the other.
    seed('popculture', 'Pop culture', {
        labels: ['Pop culture', 'Celebrity', 'Celebrities', 'Viral', 'Social media', 'Internet'],
        words: ['went viral', 'meme', 'influencer', 'streaming numbers', 'fandom'],
    }),
    // The one seed that keeps stories OFF the air rather than naming a subject. See the note above.
    seed('shopping', 'Shopping and sponsored', {
        offAir: true,
        labels: [
            'Deals',
            'Shopping',
            'Commerce',
            'Sponsored',
            'Sponsored content',
            'Sponsored post',
            'Advertisement',
            'Advertising',
            'Advertorial',
            'Partner content',
            'Paid content',
            'Promoted',
        ],
        // Longer than the other lists here, and it is allowed to be: a word that wrongly claims a
        // story costs one story out of a page, where the same word wrongly claiming it for `business`
        // would put it in the wrong bulletin. Each of these is a shop's sentence rather than a
        // reporter's.
        words: [
            'discount code',
            'promo code',
            'coupon code',
            'affiliate link',
            'earn a commission',
            'earns a commission',
            'best deals',
            'deal of the day',
            'on sale for',
            'percent off',
            'save big on',
        ],
    }),
    seed('sport', 'Sport', {
        labels: ['Sport', 'Sports', 'Football', 'Soccer', 'Basketball', 'Baseball'],
        words: ['championship', 'playoffs', 'transfer window', 'world cup', 'olympics'],
    }),
]);

/**
 * The list in the order it is written, which is the order the console draws it.
 *
 * The position is stamped HERE rather than by each entry, and both this and {@link seed} are
 * function DECLARATIONS rather than arrow constants. The list above runs at module load and calls
 * them, so a `const` declared below it is `Cannot access … before initialization` under Node's ESM
 * loader — the trap `CACHE_AHEAD` is placed to avoid, and one vitest hides because it loads modules
 * differently. This one was caught by the dev server refusing to boot, which is the good version of
 * finding it.
 */
function ordered(seeds: readonly TopicDraft[]): readonly TopicDraft[] {
    return seeds.map((draft, at) => ({ ...draft, position: at }));
}

/** One seeded category. Its position is stamped by {@link ordered}. */
function seed(key: string, label: string, config: { labels?: string[]; words?: string[]; offAir?: boolean }): TopicDraft {
    return {
        kind: NEWS_KIND,
        key,
        label,
        config: {
            // A real boolean, which is what the console writes and what `flagIsOn` reads either way.
            offAir: config.offAir ?? false,
            // Written as arrays rather than as the comma strings the form produces, because the
            // classifier reads both and an array is the shape that cannot be mis-split. The console
            // shows them joined, which is what an operator then edits.
            feeds: [],
            labels: config.labels ?? [],
            words: config.words ?? [],
        },
        position: 0,
    };
}
