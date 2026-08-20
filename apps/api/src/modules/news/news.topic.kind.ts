import type { TopicKind } from '#modules/topics/topic.js';
import { NEWS_KIND } from '#modules/director/news.break.writer.js';

/**
 * News categories, as the operator writes them.
 *
 * The `news` kind's entry in the topic chassis: what the console calls one of these, and the three
 * fields a category is written with. What they MEAN is `news.classify.ts`; this file is only the
 * form.
 *
 * ## Two fields here, and the strongest evidence is not one of them
 *
 * A story carries three kinds of evidence and the classifier ranks them (`news.classify.ts`). The
 * strongest — the FEED it came from — is stated on the FEED, as a row on the plugin that offers it,
 * so it is deliberately not a box here: a category naming feed ids by hand meant typing an id
 * derived from a name written in a different form, for a feed the operator was not looking at. What
 * is left are the two that are genuinely about the words. A publisher's own labels are what most
 * feeds actually carry. Words are the weakest and are last, because a word in a headline is a
 * coincidence often enough to matter and because a category matched on a word alone is how a
 * bulletin about a chip shop ends up in the technology slot.
 *
 * ## Every field is optional, and one of the seeds ships with none
 *
 * A category nothing matches is not broken, it is unfinished — which is exactly what `local` is on a
 * fresh install, because only the operator knows their town. The bulletin's answer to a category
 * that matches nothing is to decline the slot and say so, which is a state an operator can act on.
 */
export const NEWS_TOPIC_KIND: TopicKind = {
    kind: NEWS_KIND,
    noun: { one: 'category', many: 'categories' },
    description:
        'What a news bulletin can be about. Put a category on a band in the format clock and that bulletin reads only the stories that belong to it — ' +
        'or leave the band without one and the station spreads its headlines across whatever the categories say it has. A feed can be a whole ' +
        'category on its own: say so on the feed itself, where the plugin that reads it is configured.',
    fields: [
        {
            key: 'labels',
            label: "The publisher's own words for it",
            type: 'text',
            placeholder: 'Technology, Tech, Science and tech',
            help:
                'Comma separated. Most feeds tag their stories, and this is what those tags say. Matched whole and case-insensitively, so ' +
                '"Tech" does not catch "Biotech".',
        },
        {
            key: 'words',
            label: 'Words that mean this category',
            type: 'text',
            placeholder: 'chip, semiconductor, satellite, app store',
            help:
                'Comma separated, matched against the headline and the teaser. The weakest of the three and deliberately last: a word in a ' +
                'headline is a coincidence often enough to matter, so use these to catch what the feeds and the labels miss rather than as the ' +
                'definition of the category.',
        },
    ],
};
