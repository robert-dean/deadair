import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { PlaylistFillService, type PlaylistFillSummary } from './playlist.fill.service.js';
import { StationPlaylistsRepository } from './station.playlists.repository.js';

export interface PlaylistFillPayload {
    // Optional only because a job payload is `object` to the runner; a send without one is a run with nothing to fill.
    playlistId?: string;
}

/**
 * Looks up the records an imported playlist named and the library did not hold.
 *
 * A {@link PlainJob}, like the catalog sync: it talks to providers between writes, and holding one
 * transaction open across a few hundred searches is the thing `TransactionalJob` exists to avoid.
 *
 * Sent after an import that left placeholders, and by the console's "Look up missing records". Both
 * are somebody waiting to learn how it went, so every run says so on the activity feed.
 */
@Injectable()
export class PlaylistFillJob extends PlainJob<PlaylistFillPayload> {
    constructor(
        private readonly fill: PlaylistFillService,
        private readonly playlists: StationPlaylistsRepository,
        private readonly activity: ActivityRecorder,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: PlaylistFillPayload, signal?: AbortSignal): Promise<void> {
        const playlistId = payload?.playlistId;
        if (playlistId === undefined) return;

        const playlist = await this.playlists.find(playlistId);
        // Deleted between the send and the run, which leaves nothing to fill and nobody to tell.
        if (playlist === undefined) return;

        const summary = await this.fill.fill(playlistId, signal);
        if (summary.filled + summary.missed + summary.remaining === 0) return;

        void this.activity.record({
            module: 'catalog',
            kind: 'playlist.filled',
            severity: summary.refused === undefined ? 'info' : 'warn',
            detail: describeFill(playlist.name, summary),
            data: { playlistId, ...summary },
        });
    }
}

/** The run as a sentence, naming the playlist, because the feed is read away from the page that asked. */
export function describeFill(name: string, summary: PlaylistFillSummary): string {
    if (summary.refused === 'discover-off') {
        return `The records missing from "${name}" were not looked up: "rotation.discover" is off, so the station may not add records to its library.`;
    }

    const tried = summary.filled + summary.missed;
    const found =
        tried === 1
            ? `The record missing from "${name}" was ${summary.filled === 1 ? 'found and added to the library' : 'not found at any music source'}.`
            : `${summary.filled} of the ${tried} records missing from "${name}" ${summary.filled === 1 ? 'was' : 'were'} found and added to the library.`;
    const left = summary.remaining > 0 ? ` ${summary.remaining} more are left for the next look-up.` : '';
    return found + left;
}
