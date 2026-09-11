import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { isPluginError } from '@deadair/plugin-sdk';
import { AnalysisService } from '#modules/analysis/analysis.service.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { resolvePlayoutBaseUrl, segmentAudioUrl, storedAudioUrl } from '#modules/playout/playout.urls.js';
import { AudioUrlSigner } from '#modules/playout/audio.url.signer.js';
import type { AudioOverlay } from '@deadair/plugin-sdk';
import { splitOnPads, withoutPads } from './pad.cues.js';
import { PadRepository } from './pad.repository.js';
import { padDuckDb, padGapMs, padUnderMs } from './pad.settings.js';
import { MixerService } from './mixer.service.js';
import { SegmentRepository, type Segment } from './segment.repository.js';
import { extensionForMime, SegmentStore } from './segment.store.js';
import { SpeechService, type SpokenAudio } from './speech.service.js';
import { errorText } from '#modules/shared/error.text.js';

export interface RenderSegmentPayload {
    /**
     * Which segment to speak.
     *
     * Optional in the type and required in practice, the way `ExtendLineupPayload.lineupId` is: a
     * job registration is typed against a payload the broker may deliver as `{}`, so this cannot be
     * declared required without the mapping refusing it. The run guards on it instead.
     */
    segmentId?: string;
}

/**
 * Say a written segment out loud, and keep the audio.
 *
 * `written → rendering → ready`, or `failed` with the reason. This is the piece
 * [dj-voice](https://github.com/robert-dean/deadair/discussions/13) calls the whole of the missing infrastructure, and the second half of
 * making a break: deciding what it says is `WriteBreakJob`'s, one stage earlier.
 *
 * It starts at `written` rather than at `planned` deliberately. A break whose words have not been
 * decided is not this job's to render, and a retry after a failed synthesis re-speaks the words
 * already on the row rather than sending the break back to be rewritten — which on a model would be
 * a bill as well as a change nobody asked for.
 *
 * A plain `Job` and not a `TransactionalJob`, following `ExtendLineupJob` and `EnrichmentJob`:
 * wrapping it would pin a runtime-pool connection for the length of a synthesis, which is seconds
 * of somebody else's compute, and the writes at either end are one row each.
 *
 * ## Why nothing waits on this
 *
 * The director SKIPS a segment that is not `ready` rather than holding a slot open for it. So a
 * render that is slow, or broken, or never runs at all, costs the station a break and never
 * silence — which is what makes it safe for this to be a background job with no deadline anyone
 * downstream cares about, and why the failure path here is a logged row rather than an alert.
 *
 * Safe to retry, and guarded against being retried while still running: `claimForRender` is a
 * conditional update, so a second attempt arriving mid-synthesis finds the row already `rendering`
 * and stops rather than paying twice for the same audio.
 */
@Injectable()
export class RenderSegmentJob extends PlainJob<RenderSegmentPayload> {
    constructor(
        private readonly segments: SegmentRepository,
        private readonly speech: SpeechService,
        // What joins a padded break's takes around its hit, and the store the result lands in. Both
        // unused by the ordinary break, which is nearly all of them: a station with no soundboard
        // resolves these and never calls them.
        private readonly mixer: MixerService,
        private readonly store: SegmentStore,
        private readonly pads: PadRepository,
        // The analyzer, for how loud the result came out. A module later in the list than this one,
        // which is a lifecycle order rather than a wiring one: everything registers before anything
        // resolves, and this is resolved when a job runs.
        private readonly analysis: AnalysisService,
        private readonly config: AppConfig,
        // Every URL below is fetched by the mixer or the analyzer with no session, so each is signed.
        private readonly signer: AudioUrlSigner,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: RenderSegmentPayload, signal?: AbortSignal): Promise<void> {
        if (!payload?.segmentId) {
            // A caller's bug rather than a station fault: this job is only ever sent, never
            // scheduled, so there is no payload-less run that means anything.
            this.logger.warn('render: a segment render was sent with nothing to render', { job: this.context.id });
            return;
        }

        const segment = await this.segments.claimForRender(payload.segmentId);
        if (segment === undefined) {
            // Deleted, already rendering, or already ready. All three are ordinary races rather
            // than failures, and all three mean the same thing here: not ours to do.
            this.logger.info('render: nothing to render for this segment', { job: this.context.id, segment: payload.segmentId });
            return;
        }

        const script = segment.script?.trim();
        if (!script) {
            // Left `failed` rather than dropped back to `planned`, so it is visible in the console
            // instead of being retried forever by anything that walks planned segments.
            await this.segments.markFailed(segment.id, 'this segment has no script to say', 'rendering');
            this.logger.warn('render: a segment was planned with no script', { job: this.context.id, segment: segment.id });
            return;
        }

        if (signal?.aborted) {
            // Put it back rather than leaving it stuck in `rendering`, where nothing would ever
            // claim it again.
            await this.segments.markFailed(segment.id, 'the render was abandoned before it started', 'rendering');
            return;
        }

        try {
            const audio = await this.produce(segment, script);

            // The words that went to the engine are kept beside the words on the row, because they
            // are not the same words and only one of them explains the audio. See `SpokenAudio`.
            await this.segments.markReady(segment.id, { audioChecksum: audio.checksum, audioExt: audio.ext, spokenScript: audio.spokenText });

            this.logger.info('render: a segment is ready to air', {
                job: this.context.id,
                segment: segment.id,
                label: segment.label,
                plugin: audio.pluginId,
                ext: audio.ext,
            });

            // AFTER the row is ready, and deliberately not part of the same statement. The break can
            // air from this moment; how loud it is can catch up. See `measure`.
            await this.measure(segment.id);
        } catch (error) {
            const message = errorText(error);

            // A host that could not speak is not a segment that was wrong, and writing it off as one
            // is what [render-plugin-readiness](https://github.com/robert-dean/deadair/discussions/29) is about: `SpeechService` throws
            // `unavailable` for exactly the window where no plugin is active — a boot, or any of the
            // reinitializations every plugin config change performs — and the words on this row are
            // untouched and still correct. So the claim is handed back and the row waits at
            // `written`, which is where `claimForRender` starts, with none of `MAX_RENDER_ATTEMPTS`
            // spent on a failure that said nothing about the segment.
            //
            // A station whose speech plugin is genuinely uninstalled is not hidden by this: the row
            // sits `written` with nothing rendering it and the reason is on `segment_events`, rather
            // than being silently ready.
            if (isPluginError(error) && error.code === 'unavailable' && (await this.segments.releaseForRetry(segment.id, message))) {
                this.logger.info('render: nothing could speak this segment yet; it keeps its words and will be asked for again', {
                    job: this.context.id,
                    segment: segment.id,
                    error: message,
                });
                return;
            }

            // The reason goes on the row, because the console is where an operator looks and a log
            // line scrolls away. Not rethrown: a failed render is data, and letting it bubble would
            // spend the job's one retry on a plugin that is usually still down.
            await this.segments.markFailed(segment.id, message, 'rendering');
            this.logger.warn('render: could not speak a segment', { job: this.context.id, segment: segment.id, error: message });
        }
    }

    /**
     * The audio for one segment: one take, or several joined around a soundboard hit.
     *
     * The ordinary break is the first branch and is byte-identical to what this did before pads
     * existed, which is the shape to keep — a station with no soundboard pays nothing for one.
     *
     * **The join is an improvement, never a requirement**, which is `StitchProductionJob`'s rule
     * ("`ready` either way") applied one row down. Every way the join can fail — no mixer, a mixer
     * that refused, a pad whose file has gone, a media type this store cannot hold — falls back to
     * speaking the script whole with the cue stripped. A break that loses its drop is a break; a
     * break that loses its audio is a hole in the hour.
     */
    private async produce(segment: Segment, script: string): Promise<SpokenAudio> {
        if (segment.pads.length === 0) return await this.say(script, segment.voice);

        try {
            const padded = await this.joinAround(segment, script);
            if (padded !== undefined) return padded;
        } catch (error) {
            this.logger.warn('render: could not join a break around its soundboard hit, so it airs as words', {
                job: this.context.id,
                segment: segment.id,
                error: errorText(error),
            });
        }

        // The fallback, and it has to strip the cue itself rather than leaning on
        // `transposeForSpeech` doing it downstream: this is the one path where the words reaching
        // the engine are deliberately not the words on the row.
        return await this.say(withoutPads(script), segment.voice);
    }

    /** One take of speech, which is what this job did for every segment before soundboards. */
    private async say(text: string, voice: string | undefined): Promise<SpokenAudio> {
        return await this.speech.speak({ text, ...(voice === undefined ? {} : { voice }) });
    }

    /**
     * Several takes and a pad, joined into one file, or `undefined` for anything that did not work.
     *
     * The parts are spoken one at a time through the same {@link SpeechGate} a single take goes
     * through, so a padded break costs the engine no more concurrency than an ordinary one — it just
     * takes two turns instead of one.
     *
     * The URLs are the station's own content-addressed route, for `StitchProductionJob`'s reason:
     * the mixer runs in another container, so a path on this machine's disk is not something it can
     * fetch. A take is not a segment and never will be, which is exactly why that route addresses the
     * store rather than a row.
     */
    private async joinAround(segment: Segment, script: string): Promise<SpokenAudio | undefined> {
        const parts = splitOnPads(script);
        if (parts.length === 0) return undefined;

        // Resolved from the ROW rather than by name against a board, because the row is what the
        // writer decided under the character that was presenting then. See `segments.pads`.
        const byName = new Map(segment.pads.map(hit => [hit.name, hit.padId]));

        const base = resolvePlayoutBaseUrl(this.config);
        // Zero is a STING: the pad is a part, and the words wait for it. Anything above makes it an
        // OVERLAY that starts that far before the words end, so nothing moves and the sound happens
        // ON them. The whole difference is which of these two lists the pad goes into.
        const under = padUnderMs(this.config);

        const urls: string[] = [];
        const overlays: AudioOverlay[] = [];
        const spoken: string[] = [];
        let placed = 0;

        for (const part of parts) {
            if (part.kind === 'pad') {
                const padId = byName.get(part.name);
                const pad = padId === undefined ? undefined : await this.pads.findById(padId);
                // A pad deleted between the write and the render. Skipped rather than abandoning the
                // join, because the rest of the break is still several takes that want joining and
                // the alternative loses the sound AND the timing.
                if (pad === undefined) {
                    this.logger.info('render: a break hit a pad that is no longer there', {
                        job: this.context.id,
                        segment: segment.id,
                        pad: part.name,
                    });
                    continue;
                }

                const url = this.signer.sign(storedAudioUrl(base, pad.audioChecksum, pad.audioExt));
                if (under > 0 && urls.length > 0) {
                    // Anchored to the join AFTER the take just pushed, which is the boundary this
                    // pad sits at in the sentence. `urls.length - 1` because a join is named by the
                    // part it follows.
                    //
                    // Guarded on there being a preceding take at all: a script that OPENS on a hit
                    // has no words for the sound to land under, so it stays a part. Sending an
                    // overlay anchored to a join that does not exist is refused by the mixer, which
                    // would cost the break its whole join rather than its timing.
                    overlays.push({ url, afterIndex: urls.length - 1, offsetMs: -under, duckDb: padDuckDb(this.config) });
                } else {
                    urls.push(url);
                }
                placed += 1;
                continue;
            }

            const take = await this.say(part.text, segment.voice);
            urls.push(this.signer.sign(storedAudioUrl(base, take.checksum, take.ext)));
            spoken.push(take.spokenText);
        }

        // No pad actually landed, so there is nothing for a join to be FOR.
        //
        // Worth stating because the naive reading is that two takes still want joining: they do not.
        // The words were split for the sole purpose of putting a sound between them, and joining
        // them without it produces a break with a silent hole mid-sentence where the drop should
        // have been, out of two separately-trimmed takes that no longer share their prosody. One
        // take of the whole script is strictly better, and that is what the caller falls back to.
        if (placed === 0) return undefined;

        // Two parts is the floor for a join, and an overlaid pad does not raise it: one take with a
        // drop mixed onto it is still one part, and a mixer asked to join a single file pays a decode
        // to hand the same bytes back. It IS worth the call once there is something to mix on.
        if (urls.length < 2 && overlays.length === 0) return undefined;

        const joined = await this.mixer.join(segment.label, urls, padGapMs(this.config), { overlays });
        if (joined === undefined) return undefined;

        const ext = extensionForMime(joined.mime);
        if (ext === undefined) {
            // Nothing here can serve it, and storing bytes under a guessed extension is how a
            // segment airs as silence. The stream is let go, because the plugin is holding a socket
            // open on our behalf.
            await joined.audio.cancel().catch(() => {});
            this.logger.warn('render: the joined break came back as something the station cannot serve', {
                job: this.context.id,
                segment: segment.id,
                mime: joined.mime,
            });
            return undefined;
        }

        const checksum = await this.store.writeStream(joined.audio, ext);

        this.logger.info('render: joined a break around its soundboard hit', {
            job: this.context.id,
            segment: segment.id,
            parts: urls.length,
            overlays: overlays.length,
            ext,
        });

        // The spoken text is the TAKES' words in order and says nothing about the pad, which is
        // right: this column is the record of what the engine was handed, and the engine was never
        // handed the pad. What was hit is on `segments.pads`.
        return { checksum, ext, pluginId: 'joined', spokenText: spoken.join(' ') };
    }

    /**
     * Find out how loud the break came out, and write it down.
     *
     * A speech engine aims at no particular level, so this is the only thing that can tell the
     * station where its own voice actually landed — and the level is not the engine's constant
     * either: it moves with the voice, and to a lesser extent with the line. `speechGainFor` turns
     * this into the gain both routes to the mount are stamped with.
     *
     * **Nothing here may cost the break.** Every failure is a log line: the analyzer is optional
     * (a station with none measures nothing and airs everything), the sidecar is another container,
     * and the fallback underneath is an assumed speech level that is wrong by a decibel or so
     * rather than wrong by ten. So this is awaited but never thrown from, and the segment is
     * already `ready` before it is called.
     *
     * The URL is the station's OWN route, for the same reason the catalog's measurements use it:
     * the bytes measured are the bytes that air, and it is reachable from a sidecar container where
     * a path on this machine's disk is not.
     */
    private async measure(segmentId: string): Promise<void> {
        try {
            const url = this.signer.sign(segmentAudioUrl(resolvePlayoutBaseUrl(this.config), segmentId));
            const result = await this.analysis.measureAudio(segmentId, url);
            // `integratedLufs` is the ANALYZER's name for it and `loudnessLufs` is the item's, the
            // same translation `PickResolver.loudness` makes for a record. Reading the item's name
            // off an analyzer's blob is not a type error — `data` is `Record<string, unknown>` —
            // and it is not a visible failure either: every measurement here was discarded by the
            // guard below, silently, so 612 segments were measured and none of them was recorded.
            const loudnessLufs = result?.data.integratedLufs;

            // A measurement without a loudness figure is allowed by the contract — the cue points
            // are required and this is not — and near-silence legitimately has none.
            if (typeof loudnessLufs !== 'number' || !Number.isFinite(loudnessLufs)) return;

            await this.segments.recordLoudness(segmentId, loudnessLufs);
            this.logger.debug('render: measured a segment', { job: this.context.id, segment: segmentId, loudnessLufs });
        } catch (error) {
            this.logger.warn('render: could not measure a segment; it will air at the assumed speech level', {
                job: this.context.id,
                segment: segmentId,
                error: errorText(error),
            });
        }
    }
}
