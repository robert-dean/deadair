import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { ArchiveStore } from './archive.store.js';
import { resolveArchiveDays } from './archive.settings.js';

/** A day, for turning the setting into an age. */
const DAY_MS = 24 * 60 * 60_000;

/**
 * The nightly sweep over the archive.
 *
 * `PruneShareCopiesJob`'s shape with `PruneScriptHistoryJob`'s attitude: a recording cannot be made
 * again, so `0` keeps all of them, and the age is from when a recording ENDED rather than began, so
 * a show that ran past midnight is not lost a day early.
 */
@Injectable()
export class PruneArchiveJob extends PlainJob {
    constructor(
        private readonly store: ArchiveStore,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(): Promise<void> {
        const summary = await pruneArchive(this.store, resolveArchiveDays(this.config));

        // Quiet when there was nothing old enough, which is most nights.
        if (summary.removed > 0) {
            this.logger.info('stream: swept old recordings from the archive', { job: this.context.id, ...summary });
        }
    }
}

/**
 * Removes every finished recording that ended more than `days` ago, and says how many and how much.
 * `0` removes nothing. A recording still being written is never removed, however old its start.
 *
 * A function of its own so the sweep can be tested against a real directory without a job context.
 */
export async function pruneArchive(
    store: ArchiveStore,
    days: number,
    now: number = Date.now(),
): Promise<{ removed: number; freedBytes: number; days: number }> {
    if (days <= 0) return { removed: 0, freedBytes: 0, days };

    const cutoff = now - days * DAY_MS;
    let removed = 0;
    let freedBytes = 0;

    for (const recording of await store.list(now)) {
        if (recording.endedAt === undefined || recording.endedAt.toMillis() >= cutoff) continue;

        if (await store.remove(recording.id, now)) {
            removed += 1;
            freedBytes += recording.bytes;
        }
    }

    return { removed, freedBytes, days };
}
