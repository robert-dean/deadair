import { Container, Injectable, ScopedContainer } from 'injectkit';
import { Job, JobContext } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { overrideJobActor } from '#modules/jobs/job.authorization.js';
import { ScriptHistoryRepository } from '#modules/render/script.history.repository.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { STREAM_DEFAULTS, STREAM_KEYS } from '#modules/stream/stream.settings.js';
import type { BreakTrack } from './break.writer.js';
import { BreakWriterRegistry, isWritten, type BreakWriteResult } from './break.writer.registry.js';
import { isTrackItem, type StationLineup } from './station.lineup.js';
import { StationLineupRepository } from './station.lineup.repository.js';

/** How many recent scripts a writer is shown, so it can avoid repeating itself. */
const RECENT_WINDOW = 6;

export interface WriteBreakPayload {
    /**
     * Which segment to write.
     *
     * Optional in the type and required in practice: a job registration is typed against a payload
     * the broker may deliver as `{}`. The run guards on it instead.
     *
     * It does not name a running order, because there is only one and the director owns it.
     */
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
 * Nobody is waiting in the strong sense: a segment that is not `ready` when it comes round is
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
        private readonly order: StationLineupRepository,
        private readonly segments: SegmentRepository,
        private readonly history: ScriptHistoryRepository,
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

        if (!payload?.segmentId) {
            // A caller's bug rather than a station fault: this job is only ever sent.
            this.logger.warn('director: a break write was sent with nothing to write', { job: this.context.id });
            return;
        }
        const { segmentId } = payload;

        const lineup = await this.order.load();
        if (lineup === undefined) {
            await this.claimAndFail(segmentId, 'the running order this break was planted into is gone');
            return;
        }

        // BEFORE the claim, and this order matters more than it looks. The director writes the
        // running order through a throttle, so a break can be planted, offered and picked up here
        // within the same second — before the row anybody can read holds it. Claiming first would
        // then write a break that knows about neither of its neighbours and, having consumed the
        // claim, would never be offered again. That is a station whose every talk break is reduced
        // to saying its own name, which is exactly what it looked like when it happened.
        //
        // So: not being in the order yet is not a failure, it is being early. The row stays
        // `planned` and the next pass offers it again, by which time the write-through has landed.
        const neighbours = neighboursOf(lineup, segmentId);
        if (neighbours === undefined) {
            this.logger.info('director: this break is not in the running order yet, so it will be written on a later pass', {
                job: this.context.id,
                segment: segmentId,
            });
            return;
        }

        // Claimed rather than read, so two runs cannot both write the same break: only one
        // `planned → writing` wins and the loser stops here. That is what makes a duplicate send
        // free, which is what lets the director offer every `planned` break in its window on every
        // boundary without having to remember which ones it has already asked for.
        //
        // Deleted, already claimed, already written, already rendering: all ordinary races, and all
        // the same answer to this job, which is that it is not ours to write.
        const segment = await this.segments.claimForWrite(segmentId);
        if (segment === undefined) {
            this.logger.info('director: nothing to write for this break', { job: this.context.id, segment: segmentId });
            return;
        }

        const result = await this.writers.write({
            kind: segment.kind,
            ...neighbours,
            station: this.config.get(STREAM_KEYS.title, STREAM_DEFAULTS.title),
            recent: await this.segments.recentScripts(segment.kind, RECENT_WINDOW),
        });

        // Before the row is touched, and before any early return below, so an attempt is recorded
        // whichever way this goes. What the station TRIED is as much of the record as what it said.
        await this.remember(segmentId, segment.kind, neighbours, result);

        if (!isWritten(result)) {
            // Not an error and not logged as one: a break nothing had anything to say for is a break
            // the station does not take, and the reason is on the row for whoever asks why.
            await this.fail(segmentId, result.reason ?? `nothing wrote this ${segment.kind}`);
            return;
        }

        // `result.writer` rather than a constant: which writer produced this is the registry's
        // answer, and once a kind has more than one of them the job cannot know which one spoke.
        if (!(await this.segments.writeScript(segmentId, { ...result.written, writer: result.writer }))) {
            // The row moved out of `planned` while this was being written. Whoever moved it owns it.
            this.logger.info('director: a break was written after something else had claimed it', { job: this.context.id, segment: segmentId });
            return;
        }

        // Last, and deliberately: a render that ran before the script was committed would claim a
        // segment with nothing to say and fail it. If this send fails the row survives as a written
        // `planned` segment, which an operator can ask for again.
        await this.jobs.send('render.segment', { segmentId });
        this.logger.info('director: wrote a break', {
            job: this.context.id,
            segment: segmentId,
            label: result.written.label,
            writer: result.writer,
            // Only when something DID decline, so the ordinary line stays short. A break that took
            // two writers is the interesting one, and it is invisible from the row alone: the row
            // records who won and says nothing about who was asked first.
            ...(result.attempts.length > 1 ? { declined: result.attempts.slice(0, -1).map(attempt => attempt.reason) } : {}),
        });
    }

    /**
     * Write down every writer that was asked and what it said.
     *
     * Best-effort, and the `catch` is the whole point: nothing reads this table to decide anything,
     * so a history write that fails must cost a row and never the break it was describing. The same
     * trade `segment_events` makes, for the same reason.
     *
     * Every attempt, not only the winner. A model that declined and a floor that covered for it are
     * two facts, and the second on its own reads as a station that never had a model configured.
     */
    private async remember(
        segmentId: string,
        kind: string,
        neighbours: { previous?: BreakTrack; next?: BreakTrack },
        result: BreakWriteResult,
    ): Promise<void> {
        if (result.attempts.length === 0) return;

        try {
            await this.history.recordAll(
                result.attempts.map(attempt => ({
                    segmentId,
                    kind,
                    writer: attempt.writer,
                    outcome: attempt.outcome,
                    durationMs: attempt.durationMs,
                    ...(neighbours.previous === undefined ? {} : { previous: neighbours.previous }),
                    ...(neighbours.next === undefined ? {} : { next: neighbours.next }),
                    ...(attempt.written === undefined ? {} : { script: attempt.written.script, label: attempt.written.label }),
                    ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
                })),
            );
        } catch (error) {
            this.logger.warn(`director: could not record what was written (${error instanceof Error ? error.message : String(error)})`);
        }
    }

    /**
     * Leave the reason where an operator will look for it, rather than in a log line that scrolls.
     *
     * From `writing`, because this is only ever reached for a break this job has claimed.
     */
    private async fail(segmentId: string, reason: string): Promise<void> {
        await this.segments.markFailed(segmentId, reason, 'writing');
        this.logger.info('director: a break went unwritten', { job: this.context.id, segment: segmentId, reason });
    }

    /**
     * Give up on a break that has no running order to be written into.
     *
     * The one failure that happens BEFORE the claim, so it takes the claim on its way past. A row
     * left `planned` here would be offered again on every pass by a director whose order is gone,
     * which is a loop; failing it says why, once, where an operator will find it.
     */
    private async claimAndFail(segmentId: string, reason: string): Promise<void> {
        if ((await this.segments.claimForWrite(segmentId)) === undefined) return;
        await this.fail(segmentId, reason);
    }
}

/**
 * The records either side of a break, as the order stands now.
 *
 * Nearest record in each direction rather than strictly adjacent lines, so a break planted next to
 * another segment still knows what music it sits between. Either side may be absent, at the head or
 * the tail of an order, and that is a shape the writers already answer for.
 *
 * `undefined` for a break the order does not hold AT ALL, which is a different answer entirely and
 * the reason this does not just return an empty pair: a break with no neighbours is one at the edge
 * of an order, and a break the order has never heard of is one this job is too early for. Answering
 * the same thing for both is how every talk break ends up saying only the station's name.
 */
function neighboursOf(lineup: StationLineup, segmentId: string): { previous?: BreakTrack; next?: BreakTrack } | undefined {
    const items = lineup.all();
    const at = items.findIndex(item => item.kind === 'segment' && item.segmentId === segmentId);
    if (at < 0) return undefined;

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
