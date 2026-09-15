import type { TopicKind } from '#modules/topics/topic.js';
import { SYNDICATED_KIND } from './syndicated.kind.js';

/**
 * The shows the format clock can put on, as the operator names them.
 *
 * The `syndicated` kind's entry in the topic chassis, which is what lets a band say WHICH show it is
 * for: `21:00 syndicated / Late Night Radio`, exactly as `:30 news / Technology` says which news. A
 * band with no topic carries the newest episode of any show the station subscribes to, which is a
 * reasonable thing for an operator with one subscription to want and a strange one for anybody else.
 *
 * One field, and it is a choice rather than something typed: a show's id is the plugin's qualified
 * id for it, which nobody could type, so the console offers the shows every podcast plugin carries
 * (`station.podcastShows`). The LABEL is the operator's own word for the show, as it is for every
 * topic, and it is what a presenter introducing the programme says.
 */
export const SYNDICATED_TOPIC_KIND: TopicKind = {
    kind: SYNDICATED_KIND,
    noun: { one: 'show', many: 'shows' },
    description:
        "Somebody else's programmes the station can carry. Subscribe to a show on the Podcasts plugin's page, add it here, then put a " +
        "syndicated band on the format clock about it: at that time the station airs the show's newest episode, if it has not aired it already.",
    fields: [
        {
            key: 'show',
            label: 'Show',
            type: 'select',
            required: true,
            optionsFrom: 'station.podcastShows',
            help: "One of the shows the station subscribes to. Subscriptions live on the Podcasts plugin's settings page.",
        },
    ],
};
