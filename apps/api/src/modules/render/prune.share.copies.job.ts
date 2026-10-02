import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { SegmentShareStore, SHARE_EXTENSION } from './segment.share.store.js';
import { resolveShareCopyDays } from './segment.share.settings.js';

/** A day, for turning the setting into an age. */
const DAY_MS = 24 * 60 * 60_000;

/**
 * The nightly sweep over the copies listeners share.
 *
 * `PruneScriptHistoryJob`'s shape, with the opposite attitude to what it deletes. Those rows are the
 * only record of what was said, so `0` keeps everything; these are a cache, every one can be made
 * again from the segment's audio, and anybody signed in can add to the store. So the window always
 * has a floor (`resolveShareCopyDays`), and the age is from the last time a copy was ASKED for,
 * because a hit refreshes the file's mtime.
 *
 * Removing a copy is always safe, unlike removing from the segment store: no row names one, so no
 * other reader can be holding the same file, and the next request for it remakes it.
 */
@Injectable()
export class PruneShareCopiesJob extends PlainJob {
    constructor(
        private readonly store: SegmentShareStore,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(): Promise<void> {
        const summary = await pruneShareCopies(this.store, resolveShareCopyDays(this.config));

        // Quiet when there was nothing old enough, which is most nights.
        if (summary.copies > 0 || summary.temporaries > 0) {
            this.logger.info('render: swept old copies listeners shared', { job: this.context.id, ...summary });
        }
    }
}

/**
 * Removes every copy older than `days` and every stale `.tmp-` file, and says how many of each.
 *
 * A function of its own so the sweep can be tested against a real directory without a job context.
 */
export async function pruneShareCopies(
    store: SegmentShareStore,
    days: number,
    now: number = Date.now(),
): Promise<{ copies: number; temporaries: number; days: number }> {
    const cutoff = now - days * DAY_MS;
    let copies = 0;

    for (const file of await store.list()) {
        // A named copy only. Anything else at the root is a temp file, handled below with its own
        // grace; anything else again was put there by a person, and is reported rather than deleted.
        if (file.checksum === undefined || file.ext !== SHARE_EXTENSION) continue;
        if (file.modifiedAt.toMillis() >= cutoff) continue;

        if (await store.remove(file.checksum, file.ext)) copies += 1;
    }

    const temporaries = await store.removeStaleTemporaries(now);
    return { copies, temporaries, days };
}
