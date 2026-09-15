import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { PodcastFetchService } from './podcast.fetch.service.js';

/**
 * Which episode to fetch: the station's own id for it, `podcast_episodes.id`.
 *
 * Optional in the type because a job's payload is whatever arrived on the queue, and the mappings
 * table types every payload that way; a payload without one is a no-op rather than a crash.
 */
export interface FetchEpisodePayload {
    episodeId?: string;
}

/**
 * Fetch one episode's audio into the station's store.
 *
 * A plain job for `PlainJob`'s reason: the whole of it is a download that can run for minutes, and a
 * transaction held across that would pin a connection for its length. Its writes are the segment row
 * and the episode's own, each on its own, and an episode that already has its segment is a no-op, so
 * a duplicate send costs a read.
 *
 * Everything the fetch can fail at is recorded on the episode by the service, never thrown from here,
 * which is why this has no retry: the row says it failed and why, and the next thing to ask for it
 * (the scheduler as the slot approaches, or an operator) is the retry.
 */
@Injectable()
export class FetchEpisodeJob extends PlainJob<FetchEpisodePayload> {
    constructor(
        private readonly fetcher: PodcastFetchService,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: FetchEpisodePayload, signal?: AbortSignal): Promise<void> {
        if (payload?.episodeId === undefined) return;
        await this.fetcher.fetchEpisode(payload.episodeId, signal);
    }
}
