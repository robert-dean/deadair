import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { isAnchored, nextOccurrence } from '#modules/director/clock.bands.js';
import { ClockBandRepository } from '#modules/director/clock.band.repository.js';
import { stationZone } from '#modules/director/clock.words.js';
import { ProductionRepository } from '#modules/productions/production.repository.js';
import { SegmentRepository } from '#modules/render/segment.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import type { NarrationPieceRecord } from './narration.piece.js';
import { NarrationPieceRepository } from './narration.piece.repository.js';
import { isNarrationKind } from './narration.kind.js';
import { NarrationSource } from './narration.source.js';
import { RENDER_RETRY_AFTER_MS } from './narrations.service.js';

/**
 * How far ahead of its slot a piece is spoken.
 *
 * Twice `FETCH_AHEAD_MS`, and the difference is what the work IS. Fetching an episode is minutes of
 * somebody else's bandwidth; speaking a chapter is six to ten takes on the station's ONE speech
 * engine, each queued behind every break the station wants in the meantime and each rendered at
 * `background` so they yield to it. Six hours is that with room for an evening where the engine is
 * busy, and the cost of being early is a file on disk a little longer.
 */
export const RENDER_AHEAD_MS = 6 * 60 * 60_000;

/**
 * How many failed renders of one piece the scheduler makes before it stops asking.
 *
 * `MAX_AUTOMATIC_FETCH_ATTEMPTS`' number and its argument: every attempt is written on the piece, so
 * a fourth would be the same failure for the same reason, and an operator can still ask from the
 * console. It matters more here, because each attempt spends the station's only speech engine.
 */
export const MAX_AUTOMATIC_RENDER_ATTEMPTS = 3;

/**
 * Speak what the format clock will want, ahead of its slot, and collect what has been spoken.
 *
 * `PodcastScheduler`'s job for a band the station reads itself, and it does one thing that one does
 * not. A podcast's audio arrives as a file and the fetch job writes the segment id onto the episode;
 * a narration's arrives as a PRODUCTION, which is finished by the director noticing its beats are all
 * ready and asking the mixer to join them, and nothing in that path knows what a narration piece is.
 * So this pass is also where a finished production is attached to the piece that asked for it.
 *
 * ## Why the attach lives here and not in the stitch job
 *
 * One writer of `segment_id`, on `markFetched`'s model. The stitch job is shared with phone-ins and
 * knows nothing about this module; reaching from it into narrations would invert the module order for
 * a case that a pass already running every commit can simply look at. And the sweep has to exist
 * anyway, because the three ways a production can end badly (no mixer, a beat that could not be
 * spoken, an operator cancelling it) are all states somebody has to notice and write down.
 *
 * ## Idempotent by the row, not by memory
 *
 * Run on every commit pass, so it must be safe to run constantly. It is, because the ask is a claim
 * on the piece's own row ({@link NarrationPieceRepository.claimRender}), which a restart cannot
 * forget and a second pass cannot win twice.
 */
@Injectable()
export class NarrationScheduler {
    constructor(
        private readonly bands: ClockBandRepository,
        private readonly source: NarrationSource,
        private readonly pieces: NarrationPieceRepository,
        private readonly productions: ProductionRepository,
        private readonly segments: SegmentRepository,
        private readonly jobs: PgBossJobBroker,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Collect what has been spoken, and ask for what the clock will want next.
     *
     * Answers how many renders it asked for. Everything is swallowed: a scheduler that threw would
     * take the commit pass with it, and a piece nobody spoke costs one slot of ordinary programming.
     */
    async ripen(now = Date.now()): Promise<number> {
        try {
            return await this.speakAhead(now);
        } catch (error) {
            this.logger.warn(`narrations: could not make what the clock will want (${errorText(error)})`);
            return 0;
        }
    }

    private async speakAhead(now: number): Promise<number> {
        const bands = (await this.bands.active()).filter(isAnchored).filter(band => isNarrationKind(band.kind));
        if (bands.length === 0) return 0;

        const zone = stationZone(this.config);
        let asked = 0;

        for (const band of bands) {
            const at = nextOccurrence(band, now, zone);
            if (at - now > RENDER_AHEAD_MS) continue;

            const found = await this.source.pieceFor(band.topic);
            if ('declined' in found) continue;

            const { piece } = found;
            // Already spoken: nothing to do but wait for the band to place it.
            if (piece.segmentId !== undefined) continue;

            // Being spoken, or was: whatever its production did, the piece's row learns it here.
            if (piece.productionId !== undefined) {
                await this.collect(piece, piece.productionId);
                continue;
            }

            if (piece.renderAttempts >= MAX_AUTOMATIC_RENDER_ATTEMPTS) continue;
            if (!(await this.pieces.claimRender(piece.id, now, RENDER_RETRY_AFTER_MS, at))) continue;

            await this.jobs.send('narrations.render', { pieceId: piece.id });
            asked += 1;

            this.logger.info('narrations: the station clock will read something, so it is being spoken', {
                piece: piece.id,
                series: piece.seriesId,
                at: new Date(at).toISOString(),
            });
        }

        return asked;
    }

    /**
     * What became of the production this piece is waiting on.
     *
     * Five outcomes, and each is a state somebody has to write down or the piece waits forever:
     *
     * - **Ready with joined audio**: the ordinary one. The piece gets the segment, and the production
     *   is moved to `aired` so it leaves `ProductionRepository.unfinished`. That list is capped at
     *   twenty and ordered oldest first, so readings parked in it would eventually crowd out every
     *   phone-in waiting to be placed. Safe because the planner's own `insert` sets no `groupId`, and
     *   `releaseUnheardProductions` only ever hands back a group.
     * - **Ready with no joined row**: a station with no mixer, or one whose mixer could not join. A
     *   block of beats cannot ride a single-segment answer, so unlike a phone-in this cannot air as
     *   its parts; it is a failure with a reason an operator can read.
     * - **Failed or cancelled**: recorded on the piece, which also clears the production so the next
     *   pass may claim a fresh one.
     * - **Still being spoken**: the ordinary state on most passes. Nothing to do.
     */
    private async collect(piece: NarrationPieceRecord, productionId: string): Promise<void> {
        const production = await this.productions.findById(productionId);

        // The row went away under us: a production deleted by hand. Clear the pointer so the piece can
        // be claimed again rather than waiting on something that no longer exists.
        if (production === undefined) {
            await this.pieces.markRenderFailed(piece.id, 'the production making this reading is gone');
            return;
        }

        if (production.state === 'failed' || production.state === 'cancelled') {
            await this.pieces.markRenderFailed(piece.id, production.error ?? `the production was ${production.state}`);
            return;
        }

        if (production.state !== 'ready') return;

        const joined = await this.segments.joinedOf(productionId);
        if (joined === undefined) {
            await this.pieces.markRenderFailed(piece.id, 'the station has no mixer to join the parts of a reading into one piece of audio');
            await this.productions.fail(productionId, 'a reading cannot air as separate beats, and nothing joined them');
            return;
        }

        await this.pieces.markRendered(piece.id, joined.id);
        await this.productions.moveTo(productionId, 'aired', 'ready');

        this.logger.info('narrations: a reading has been spoken and is ready for its slot', {
            piece: piece.id,
            series: piece.seriesId,
            segment: joined.id,
            durationMs: joined.durationMs,
        });
    }
}
