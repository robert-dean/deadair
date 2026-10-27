import type { ClockBand } from '#modules/director/clock.bands.js';
import type { TopicKind } from '#modules/topics/topic.js';

/**
 * The band kind a station's own show goes on the format clock as.
 *
 * The production kind every episode of an own show already is (`OwnShowsService.requestEpisode`), so a
 * band naming one is a production band like any `podcast` band, and only the topic says whose episode
 * it is.
 */
export const OWN_SHOW_BAND_KIND = 'podcast';

/**
 * Whether a band is one of the station's own shows on the clock: a `podcast` band with a topic, since a
 * show is the only thing a `podcast` topic can name. Read by `ProductionScheduler`, which passes these
 * over, and by `OwnShowScheduler`, which makes them; the two have to agree or a slot is made twice.
 */
export const namesOwnShow = (band: ClockBand): boolean => band.kind.trim().toLowerCase() === OWN_SHOW_BAND_KIND && band.topic !== undefined;

/**
 * The station's own shows the format clock can put on, as the operator names them.
 *
 * `SYNDICATED_TOPIC_KIND`'s entry for the other half of the Podcasts page: a show the station MAKES
 * rather than one it carries. A `podcast` band about one has that show's next episode made ahead of the
 * band and aired at it, with the show's presenter, length, feeds and research, which is how a news show
 * becomes an evening edition rather than something somebody has to remember to ask for. A `podcast` band
 * with no topic is what it always was: a programme about whatever the broadcast it airs inside is about.
 *
 * One field, a choice: the show's id is a row id nobody could type, so the console offers the station's
 * own shows (`station.ownShows`). The LABEL is the operator's own word for it, as it is for every topic.
 */
export const OWN_SHOW_TOPIC_KIND: TopicKind = {
    kind: OWN_SHOW_BAND_KIND,
    noun: { one: 'show', many: 'shows' },
    description:
        "The station's own shows, made rather than carried. Make a show on the Podcasts page, add it here, then put a podcast band on the " +
        'format clock about it: the station makes the next episode ahead of that time and airs it then. A show that reads the news makes ' +
        'a fresh edition each time.',
    fields: [
        {
            key: 'show',
            label: 'Show',
            type: 'select',
            required: true,
            optionsFrom: 'station.ownShows',
            help: 'One of the shows the station makes for itself, from the Podcasts page.',
        },
    ],
};
