import { Container, Injectable, ScopedContainer } from 'injectkit';
import { Job, JobContext } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { overrideJobActor } from '#modules/jobs/job.authorization.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import type { BreakTrack } from './break.writer.js';
import { BreakWriterRegistry, isWritten } from './break.writer.registry.js';
import { isTrackItem, type Lineup } from './lineup.js';
import { LineupRepository } from './lineup.repository.js';
import { DETERMINISTIC_WRITER } from './talk.break.writer.js';

/** How many recent scripts a writer is shown, so it can avoid repeating itself. */
const RECENT_WINDOW = 6;

export interface WriteBreakPayload {
    /**
     * Which running order the break was planted into, and which segment it is.
     *
     * Both optional in the type and required in practice, the way `ExtendLineupPayload.lineupId`
     * is: a job registration is typed against a payload the broker may deliver as `{}`. The run
     * guards on them instead.
     */
    lineupId?: string;
    segmentId?: string;
}

/**
 * Write the words for a break that has already been planted.
 *
 * The slow half of planting one. `BreakPlanner` puts the segment row and its place in the running
 * order down synchronously, because that is what keeps planting idempotent — the next pass over the
 * order sees the gap filled and plants nothing — and everything after it happens here, where nobody
 * is waiting.
 *
 * Nobody is waiting in the strong sense: a segment that is not `ready` when the cursor reaches it is
 * SKIPPED, never held for. So a writer that is slow, a model that is down, or this job never running
 * at all costs the station a break and never silence. That is the rule the whole design rests on and
 * the reason this can be a background job with no deadline.
 *
 * A plain `Job` rather than a `TransactionalJob`, following `ExtendLineupJob` and
 * `RenderSegmentJob`: the writes are one row each and a model binding later will be slow enough that
 * pinning a runtime-pool connection across it would be a real cost. Because it is not transactional,
 * the actor has to be installed here.
 *
 * ## Why it re-reads the running order
 *
 * The neighbours are derived here rather than carried in the payload, because between planting and
 * writing an operator can move a line, the director can commit, and a refill can append. A payload
 * snapshot would have the station back-announcing a record it did not play, which is the one mistake
 * a listener can catch it out in. Reading the order now costs one query and is always current.
 */
@Injectable()
export class WriteBreakJob implements Job<WriteBreakPayload> {
    constructor(
        private readonly lineups: LineupRepository,
        private readonly segments: SegmentRepository,
        private readonly writers: BreakWriterRegistry,
        private readonly jobs: PgBossJobBroker,
        private readonly config: AppConfig,
        private readonly context: JobContext,
        // `Container` resolves to the container doing the resolving, which for a job is the runner's
        // per-execution scope. `ScopedContainer` is a type alias, not a token, so it can only be the
        // cast — same as ExtendLineupJob.
        private readonly container: Container,
        private readonly logger: Logger,
    ) {}

    async run(payload?: WriteBreakPayload): Promise<void> {
        overrideJobActor(this.container as ScopedContainer, this.context);

        if (!payload?.lineupId || !payload.segmentId) {
            // A caller's bug rather than a station fault: this job is only ever sent.
            this.logger.warn('director: a break write was sent with nothing to write', { job: this.context.id });
            return;
        }
        const { lineupId, segmentId } = payload;

        const segment = await this.segments.findById(segmentId);
        if (segment === undefined || segment.state !== 'planned') {
            // Deleted, already written, already rendering. All ordinary races, and all the same
            // answer: not ours to write.
            this.logger.info('director: nothing to write for this break', { job: this.context.id, segment: segmentId });
            return;
        }

        const lineup = await this.lineups.load(lineupId);
        if (lineup === undefined) {
            await this.fail(segmentId, 'the running order this break was planted into is gone');
            return;
        }

        const written = await this.writers.write({
            kind: segment.kind,
            ...neighboursOf(lineup, segmentId),
            station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
            recent: await this.segments.recentScripts(segment.kind, RECENT_WINDOW),
        });

        if (!isWritten(written)) {
            // Not an error and not logged as one: a break nothing had anything to say for is a break
            // the station does not take, and the reason is on the row for whoever asks why.
            await this.fail(segmentId, written.reason);
            return;
        }

        if (!(await this.segments.writeScript(segmentId, { ...written, writer: DETERMINISTIC_WRITER }))) {
            // The row moved out of `planned` while this was being written. Whoever moved it owns it.
            this.logger.info('director: a break was written after something else had claimed it', { job: this.context.id, segment: segmentId });
            return;
        }

        // Last, and deliberately: a render that ran before the script was committed would claim a
        // segment with nothing to say and fail it. If this send fails the row survives as a written
        // `planned` segment, which an operator can ask for again.
        await this.jobs.send('render.segment', { segmentId });
        this.logger.info('director: wrote a break', { job: this.context.id, segment: segmentId, label: written.label });
    }

    /** Leave the reason where an operator will look for it, rather than in a log line that scrolls. */
    private async fail(segmentId: string, reason: string): Promise<void> {
        await this.segments.markFailed(segmentId, reason, 'planned');
        this.logger.info('director: a break went unwritten', { job: this.context.id, segment: segmentId, reason });
    }
}

/**
 * The records either side of a break, as the order stands now.
 *
 * Nearest record in each direction rather than strictly adjacent lines, so a break planted next to
 * another segment still knows what music it sits between. Either side may be absent, at the head or
 * the tail of an order, and that is a shape the writers already answer for.
 */
function neighboursOf(lineup: Lineup, segmentId: string): { previous?: BreakTrack; next?: BreakTrack } {
    const items = lineup.all();
    const at = items.findIndex(item => item.kind === 'segment' && item.segmentId === segmentId);
    if (at < 0) return {};

    const nearest = (from: number, step: number): BreakTrack | undefined => {
        for (let index = from; index >= 0 && index < items.length; index += step) {
            const item = items[index]!;
            if (isTrackItem(item)) return { title: item.track.title, artist: item.track.artists[0] ?? 'an unknown artist' };
        }
        return undefined;
    };

    const previous = nearest(at - 1, -1);
    const next = nearest(at + 1, 1);
    return {
        ...(previous === undefined ? {} : { previous }),
        ...(next === undefined ? {} : { next }),
    };
}
