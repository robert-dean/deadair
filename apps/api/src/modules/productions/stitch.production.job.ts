import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { AnalysisService } from '#modules/analysis/analysis.service.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { MixerService } from '#modules/render/mixer.service.js';
import { resolvePlayoutBaseUrl, segmentAudioUrl } from '#modules/playout/playout.urls.js';
import { SegmentRepository, type Segment } from '#modules/render/segment.repository.js';
import { SegmentStore, extensionForMime } from '#modules/render/segment.store.js';
import { errorText } from '#modules/shared/error.text.js';
import { ProductionRepository } from './production.repository.js';
import { stationGapMs } from './production.settings.js';
import type { Production } from './production.js';

export interface StitchProductionPayload {
    /** Which production to join. Optional in the type and required in practice, as every payload here is. */
    productionId?: string;
}

/**
 * Join a finished production's beats into one piece of audio.
 *
 * `rendering → stitching → ready`, and `ready` either way: this job exists to make a programme
 * BETTER, never to be the thing that stops one airing.
 *
 * ## What it buys
 *
 * A beat is one model call in one voice, so a production is written one beat at a time and each beat
 * is its own `deadair.segments` row. It used to AIR that way too — seven turns of a three-minute
 * phone-in were seven items in the running order, seven hand-overs to the player and seven metadata
 * changes on the mount — and the pause between one turn and the next was the speech engine's own
 * leading and trailing silence plus whatever the transport added at the boundary. Nothing could tune
 * it, because there was nothing between the beats to tune.
 *
 * Joined, the pause is `render.productionGapMs` and nothing else, because the mixer trims each
 * beat to where it actually starts and stops first. Everything else this buys — one title on the
 * mount, one item to remove, one loudness reading over the finished thing — is worth having and is
 * not the reason.
 *
 * ## Every failure lands in the same place
 *
 * No mixer, a join that threw, a media type the store cannot hold: all of them leave the
 * production `ready` with no joined row, and the director then places the
 * beats as a block exactly as it did before any of this existed. That is why nothing here throws and
 * why the state is moved on in a `finally` — a production stuck in `stitching` would be a programme
 * that was made and never aired, which is a worse outcome than every failure this is guarding.
 *
 * ## Why it is not a pass of `ProduceProductionJob`
 *
 * The passes are model work and share one gate, one budget and one cancellation story. This is a
 * decode in a sidecar and needs none of them, and it starts from a state the produce job never sees:
 * the beats are only joinable once the RENDER jobs behind them have finished, which is minutes after
 * the last pass returned. The director notices that, exactly as it notices a break becoming ready.
 */
@Injectable()
export class StitchProductionJob extends PlainJob<StitchProductionPayload> {
    constructor(
        private readonly productions: ProductionRepository,
        private readonly segments: SegmentRepository,
        private readonly store: SegmentStore,
        private readonly mixer: MixerService,
        private readonly analysis: AnalysisService,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: StitchProductionPayload): Promise<void> {
        if (!payload?.productionId) {
            this.logger.warn('productions: a stitch was sent with nothing to stitch', { job: this.context.id });
            return;
        }

        // Claimed rather than read, on the same terms every pass takes: a production somebody
        // cancelled, or one a duplicate delivery already joined, matches no `stitching` row and this
        // returns having spent nothing.
        const claimed = await this.productions.claim(payload.productionId, 'stitching', 'stitching');
        if (claimed === undefined) {
            this.logger.info('productions: nothing to stitch for this production', { job: this.context.id, production: payload.productionId });
            return;
        }

        try {
            await this.stitch(claimed);
        } catch (error) {
            // Logged and swallowed. A production that could not be joined is a production that airs
            // as its beats, which is a seam rather than a loss.
            this.logger.warn('productions: could not join a production, so it will air as its beats', {
                job: this.context.id,
                production: claimed.id,
                error: errorText(error),
            });
        } finally {
            // Always, and guarded on `stitching` so it can only ever move this job's own claim. The
            // director is waiting on this state and a row left here would never air.
            await this.productions.moveTo(claimed.id, 'ready', 'stitching');
        }
    }

    /** The join itself. Answers nothing: what it did is on the row, or the row is not there. */
    private async stitch(production: Production): Promise<void> {
        if ((await this.segments.joinedOf(production.id)) !== undefined) {
            // A duplicate delivery, or a retry after the state moved. The unique index would refuse
            // a second row anyway; this answers before paying a sidecar to make one.
            this.logger.info('productions: this production has already been joined', { job: this.context.id, production: production.id });
            return;
        }

        const beats = await this.segments.beatsOf(production.id);
        if (beats.length === 0) return;

        // The station's OWN route for every part, for the reason the measurement uses it: the bytes
        // joined are the bytes that aired, and it is reachable from a sidecar container where a path
        // on this machine's disk is not.
        const base = resolvePlayoutBaseUrl(this.config);
        const urls = beats.map(beat => segmentAudioUrl(base, beat.id));
        const gapMs = stationGapMs(this.config);

        const joined = await this.mixer.join(production.title, urls, gapMs);
        if (joined === undefined) return;

        const ext = extensionForMime(joined.mime);
        if (ext === undefined) {
            // Nothing here can serve it, and storing bytes under a guessed extension is how a
            // segment airs as silence. The stream is let go, because the plugin is holding a socket
            // open on our behalf.
            await joined.audio.cancel().catch(() => {});
            this.logger.warn('productions: the joined audio came back as something the station cannot serve', {
                job: this.context.id,
                production: production.id,
                mime: joined.mime,
            });
            return;
        }

        const checksum = await this.store.writeStream(joined.audio, ext);
        const segment = await this.segments.planJoined({
            productionId: production.id,
            kind: production.kind,
            // The programme's own name, which is what ends up on the mount while it airs — where the
            // beats each carried "Title (3/7)".
            label: production.title,
            script: scriptOf(beats),
            audioChecksum: checksum,
            audioExt: ext,
            ...(joined.durationMs === undefined ? {} : { durationMs: joined.durationMs }),
        });

        this.logger.info('productions: joined a production into one segment', {
            job: this.context.id,
            production: production.id,
            segment: segment.id,
            beats: beats.length,
            gapMs,
            ext,
            durationMs: joined.durationMs,
        });

        // AFTER the row exists, exactly as the render path measures a break: the programme can air
        // from this moment and how loud it is can catch up. Its beats were each measured on their
        // own, and none of those figures describes this file.
        await this.measure(segment.id);
    }

    /**
     * How loud the joined programme came out, best-effort.
     *
     * The same call `RenderSegmentJob` makes and held to the same rule: nothing here may cost the
     * production.
     *
     * **The one place this job needs the ANALYZER rather than the mixer**, and since the split those
     * are two picks: a station can perfectly well join a programme and then have nothing to measure
     * it with, where before, reaching here at all proved there was an analyzer. `measureAudio`
     * already answers `undefined` for having none, so the degradation is the one that was always
     * here — the programme airs at the assumed speech level.
     */
    private async measure(segmentId: string): Promise<void> {
        try {
            const result = await this.analysis.measureAudio(segmentId, segmentAudioUrl(resolvePlayoutBaseUrl(this.config), segmentId));
            const loudnessLufs = result?.data.integratedLufs;
            if (typeof loudnessLufs !== 'number' || !Number.isFinite(loudnessLufs)) return;

            await this.segments.recordLoudness(segmentId, loudnessLufs);
        } catch (error) {
            this.logger.warn('productions: could not measure a joined production; it will air at the assumed speech level', {
                job: this.context.id,
                segment: segmentId,
                error: errorText(error),
            });
        }
    }
}

/**
 * The beats' words in order, as the joined row's script.
 *
 * Kept to be READ and never to be spoken — the row is born `ready`, which `claimForRender` will not
 * take — so this is what a console shows and what `/scripts` answers, rather than anything an engine
 * will ever see.
 */
const scriptOf = (beats: readonly Segment[]): string =>
    beats
        .map(beat => beat.script?.trim())
        .filter((script): script is string => script !== undefined && script.length > 0)
        .join('\n\n');
