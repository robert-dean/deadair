import type { TopicKind } from '#modules/topics/topic.js';
import { WEATHER_KIND } from './weather.kind.js';

/**
 * The OTHER places the station talks about, as the operator writes them.
 *
 * The `weather` kind's entry in the topic chassis: what the console calls one of
 * these, and the two fields a location is written with. What they MEAN is
 * `weather.topic.ts`; this file is only the form.
 *
 * ## These are not where the station IS
 *
 * That is `station.location`, a setting, and it is deliberately not a topic. A
 * station has exactly one home and every weather feature falls back to it, so
 * making an operator create a row to get their own weather would be a setup step
 * with nothing to decide in it. What a topic is FOR is the second place: a band
 * on the format clock that reads the weather in Atlanta at twenty past, a
 * presenter mentioning the town the station's audience commutes to.
 *
 * The description says so, because an operator who duplicates their own town
 * here has not broken anything and has made two rows that can disagree.
 *
 * ## The label is what gets SAID, and the place is what gets looked up
 *
 * Two fields rather than one, and this is the whole reason: a service finds
 * `Chipping Norton, Oxfordshire, England` and a presenter says `town`. Making
 * the operator's own word for it the label — which is what the chassis already
 * gives every kind — is what lets those differ without a mapping table.
 *
 * ## Units are an override and default to saying nothing
 *
 * Empty means "as the station does", which is what nearly every row wants: a
 * station reports every place it mentions in the units its LISTENERS think in,
 * not in the ones each place uses. The override exists for the row where that is
 * genuinely wrong — a station broadcasting to two countries — and its default has
 * to be inheritance or the first operator to add a location silently pins it.
 */
export const WEATHER_TOPIC_KIND: TopicKind = {
    kind: WEATHER_KIND,
    noun: { one: 'location', many: 'locations' },
    description:
        'The other places the station talks about the weather in. Where the station itself is lives in Settings, and every weather break falls ' +
        'back to it — so add a location here only for somewhere ELSE, then point a band on the format clock at it.',
    fields: [
        {
            key: 'place',
            label: 'The place to look up',
            type: 'string',
            required: true,
            placeholder: 'Chipping Norton, Oxfordshire',
            help:
                'A town or city, qualified enough that the weather service finds the right one — there is more than one Birmingham. What the ' +
                'station SAYS is the name you gave this location above, so this can be as precise as it needs to be.',
        },
        {
            key: 'units',
            label: 'Units',
            type: 'select',
            options: [
                { value: '', label: 'As the station does' },
                { value: 'metric', label: 'Celsius and km/h' },
                { value: 'imperial', label: 'Fahrenheit and mph' },
            ],
            help: 'Leave this alone unless this one place should be reported differently from the rest of the station.',
        },
    ],
};
