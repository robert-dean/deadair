import type { TopicKind } from '#modules/topics/topic.js';
import { NARRATION_KIND } from './narration.kind.js';

/**
 * The things the format clock can have read out, as the operator names them.
 *
 * `SYNDICATED_TOPIC_KIND`'s entry one capability over, and one thing about it differs. A syndicated
 * band with no topic carries the newest episode of ANY show, which is reasonable for an operator with
 * one subscription. There is no such answer here: "the next piece of any series" would read chapter
 * four of one book and then chapter one of another, so the series is required and a band that names
 * none declines.
 *
 * One field, and it is a choice rather than something typed: a series' id is the plugin's qualified
 * id for it, which nobody could type, so the console offers the series every narration plugin offers
 * (`station.narrationSeries`). The LABEL is the operator's own word for it, as it is for every topic,
 * and it is what a presenter introducing the reading says.
 */
export const NARRATION_TOPIC_KIND: TopicKind = {
    kind: NARRATION_KIND,
    noun: { one: 'series', many: 'series' },
    description:
        'Books, columns and anything else the station reads out in its own voice. Point a narration plugin at something, add it here, then put a ' +
        'narration band on the format clock about it: at that time the station reads the next piece, in the presenter voice, and remembers where ' +
        "it got to. The next piece is the next chapter of a book, or the newest issue of a column.",
    fields: [
        {
            key: 'series',
            label: 'Series',
            type: 'select',
            required: true,
            optionsFrom: 'station.narrationSeries',
            help: "One of the things the station has been given to read. They come from a narration plugin's own settings page.",
        },
    ],
};
