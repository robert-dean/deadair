import type { TopicKind } from '#modules/topics/topic.js';
import { NEWS_KIND } from '#modules/director/news.break.writer.js';

/**
 * News categories, as the operator writes them.
 *
 * The `news` kind's entry in the topic chassis: what the console calls one of these, and the three
 * fields a category is written with. What they MEAN is `news.classify.ts`; this file is only the
 * form.
 *
 * ## Three fields, because a story carries three kinds of evidence
 *
 * A feed is a decision somebody already made — the publisher's technology feed is technology — and
 * it is the only one of the three that cannot be wrong, which is why it ranks first in the
 * classifier. A publisher's own labels are nearly as good and are what most feeds actually carry.
 * Words are the weakest and are last, because a word in a headline is a coincidence often enough to
 * matter and because a category matched on a word alone is how a bulletin about a chip shop ends up
 * in the technology slot.
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
        'or leave the band without one and the station spreads its headlines across whatever the categories say it has.',
    fields: [
        {
            key: 'feeds',
            label: 'Feeds that are always this',
            type: 'text',
            placeholder: 'deadair.rss:world\ndeadair.rss:tech',
            help:
                'One feed id per line, exactly as it is listed on the feeds a plugin offers. Everything from these feeds counts as this category, ' +
                'which is the surest way to say what a category is: a publisher who has already sorted their own newsroom has done the work.',
        },
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
