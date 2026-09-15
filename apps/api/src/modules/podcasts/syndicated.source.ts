import { Injectable } from 'injectkit';
import type { ClockBandSubject } from '#modules/director/clock.bands.js';
import { TopicRepository } from '#modules/topics/topic.repository.js';
import type { PodcastEpisodeRecord } from './podcast.episode.js';
import { PodcastEpisodeRepository } from './podcast.episode.repository.js';
import { SYNDICATED_KIND } from './syndicated.kind.js';

/** What a `syndicated` band is filled with: a segment the station holds, and how long the publisher says it runs. */
export type SyndicatedAnswer = { segmentId: string; durationMs?: number } | { declined: string };

/**
 * What a `syndicated` band on the format clock carries, decided in one place.
 *
 * `BulletinSource`'s shape for the same reason: the band names a subject (here, a show), the subject
 * is resolved against the operator's own topics per call so an edit applies at the next boundary,
 * and the planner that fills the band and the scheduler that fetches ahead of it ask the SAME
 * question through {@link episodeFor}, so the episode fetched for nine o'clock is the episode aired
 * at nine o'clock.
 *
 * ## It declines rather than guessing
 *
 * A band about a show whose topic names no show, a show with nothing new, an episode that could not
 * be fetched in time: every one of them DECLINES the slot, and the station goes on with ordinary
 * programming. Airing a different show, or an older episode, under a slot the operator gave to this
 * one is the failure `BulletinSource` refuses for news, and for the same reason: silence is a state an
 * operator can see, and the wrong programme is not.
 */
@Injectable()
export class SyndicatedSource {
    constructor(
        private readonly topics: TopicRepository,
        private readonly episodes: PodcastEpisodeRepository,
    ) {}

    /**
     * The episode a band about this subject means, whether or not the station holds its audio yet.
     *
     * `undefined` with a reason when there is none to mean. No subject is every show the station
     * carries; a subject that names no show is nothing, rather than every show, because the operator
     * who pointed a band at a topic meant that topic.
     */
    async episodeFor(subject: ClockBandSubject | undefined): Promise<{ episode: PodcastEpisodeRecord } | { declined: string }> {
        let showId: string | undefined;
        if (subject !== undefined) {
            const topic = (await this.topics.list(SYNDICATED_KIND)).find(candidate => candidate.id === subject.id);
            const named = typeof topic?.config.show === 'string' ? topic.config.show.trim() : '';
            if (named.length === 0) return { declined: `the show "${subject.label}" names no subscription` };
            showId = named;
        }

        const episode = await this.episodes.newest(showId);
        if (episode === undefined) return { declined: subject === undefined ? 'no show has a new episode' : `"${subject.label}" has no new episode` };

        return { episode };
    }

    /**
     * What to put in a `syndicated` band's slot now: the episode this subject means, if the station
     * holds its audio and has not already put it in the order.
     *
     * `onOrder` is every segment the running order already names, so a band that comes round again
     * before the last occurrence's episode has aired does not plant the same programme twice.
     */
    async segmentFor(subject: ClockBandSubject | undefined, onOrder: ReadonlySet<string>): Promise<SyndicatedAnswer> {
        const found = await this.episodeFor(subject);
        if ('declined' in found) return found;

        const { episode } = found;
        if (episode.segmentId === undefined) {
            return {
                declined:
                    episode.fetchError === undefined
                        ? `"${episode.title}" is not fetched yet`
                        : `"${episode.title}" could not be fetched (${episode.fetchError})`,
            };
        }
        if (onOrder.has(episode.segmentId)) return { declined: `"${episode.title}" is already in the running order` };

        return { segmentId: episode.segmentId, ...(episode.durationMs === undefined ? {} : { durationMs: episode.durationMs }) };
    }
}
