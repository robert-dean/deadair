import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import type { AudioOverlay, JoinedAudio } from '@deadair/plugin-sdk';
import { resolvePlayoutBaseUrl, storedAudioUrl } from '#modules/playout/playout.urls.js';
import { AudioUrlSigner } from '#modules/playout/audio.url.signer.js';
import { splitOnPads } from './pad.cues.js';
import { padGainDb, padLoudness } from './pad.level.js';
import { padDuckDb, padGapMs, padLevelDb, padUnderMs } from './pad.settings.js';
import { MixerService } from './mixer.service.js';
import { extensionForMime, type SegmentExtension } from './segment.store.js';
import type { Pad } from './pad.repository.js';
import type { SpokenAudio } from './speech.service.js';

/** What one padded script needs from whoever is asking for it joined. */
export interface PadJoinRequest {
    /** What this is, for the log lines. Not read back. */
    label: string;
    /** The script, with its `[sfx:…]` hits still in it. */
    script: string;
    /**
     * The pad a name in the script stands for, or `undefined` for one that is no longer there.
     *
     * The caller's, because the two callers answer it from different places: a break resolves from
     * its ROW, which recorded the hit under whoever was presenting when it was written, and a preview
     * resolves by name against the board it was handed.
     */
    resolve: (name: string) => Promise<Pad | undefined>;
    /**
     * Speak one run of words into the segment store.
     *
     * The caller's too, because how the words are read (the voice, the delivery, the rank at the
     * speech gate) is a fact about the caller. Every run of one script is read the same way.
     */
    say: (text: string) => Promise<SpokenAudio>;
}

/** A script joined around its hits, with the bytes not yet read. */
export interface PadJoined {
    /** The joined bytes, for the caller to write into whichever store it keeps them in. */
    audio: JoinedAudio['audio'];
    ext: SegmentExtension;
    /** The takes' words in order. Says nothing about the pad, which no engine was ever handed. */
    spokenText: string;
    /** How many parts were joined and how many pads were laid over them, for the caller's log line. */
    parts: number;
    overlays: number;
}

/**
 * Several takes and a pad, joined into one file.
 *
 * The one place a soundboard hit becomes audio, shared by the two things that make one: a break the
 * station is going to air (`RenderSegmentJob`) and a script an operator wants to hear first
 * (`RenderService.previewSpeech`). Both have to put the pad at the same level and in the same place,
 * or a preview is a demonstration of a different station.
 *
 * The parts are spoken one at a time through whatever `say` the caller hands over, which for both
 * callers is the one {@link SpeechGate}, so a padded script costs the engine no more concurrency than
 * an ordinary one — it just takes two turns instead of one.
 *
 * The URLs are the station's own content-addressed route, for `StitchProductionJob`'s reason: the
 * mixer runs in another container, so a path on this machine's disk is not something it can fetch.
 * A take is not a segment and never will be, which is exactly why that route addresses the store
 * rather than a row.
 */
@Injectable()
export class PadJoiner {
    constructor(
        private readonly mixer: MixerService,
        // Every URL below is fetched by the mixer with no session, so each is signed.
        private readonly signer: AudioUrlSigner,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * The script joined around its hits, or `undefined` for anything that did not work.
     *
     * **`undefined` is an ordinary answer**, and every caller has the same one to it: speak the
     * script whole with the cue stripped. No mixer, a mixer that refused, a pad that has gone, a media
     * type this store cannot hold, and a script whose hits all failed to resolve all land here.
     * A take that could not be SPOKEN is different, and is thrown: that is the engine failing, which
     * the fallback would only meet again.
     */
    async join(request: PadJoinRequest): Promise<PadJoined | undefined> {
        const parts = splitOnPads(request.script);
        if (parts.length === 0) return undefined;

        const base = resolvePlayoutBaseUrl(this.config);
        // Zero is a STING: the pad is a part, and the words wait for it. Anything above makes it an
        // OVERLAY that starts that far before the words end, so nothing moves and the sound happens
        // ON them. The whole difference is which of these two lists the pad goes into.
        const under = padUnderMs(this.config);

        const urls: string[] = [];
        // One per entry in `urls`, by index: a gain for a sting, nothing for a take.
        const gains: (number | undefined)[] = [];
        const overlays: AudioOverlay[] = [];
        const spoken: string[] = [];
        let placed = 0;

        for (const part of parts) {
            if (part.kind === 'pad') {
                const pad = await request.resolve(part.name);
                // A pad deleted between the write and the render. Skipped rather than abandoning the
                // join, because the rest of the script is still several takes that want joining and
                // the alternative loses the sound AND the timing.
                if (pad === undefined) {
                    this.logger.info('render: a script hit a pad that is no longer there', { label: request.label, pad: part.name });
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
                    // would cost the script its whole join rather than its timing.
                    //
                    // Levelled against the words it lands on rather than mixed at whatever its maker
                    // mastered it to, by its measured loudness or, for a sound too short to have one,
                    // by its peak. Omitted for a pad with neither, so that case puts exactly the
                    // request on the wire it did before levelling existed.
                    const gainDb = padGainDb(padLoudness(pad), padLevelDb(this.config));
                    overlays.push({
                        url,
                        afterIndex: urls.length - 1,
                        offsetMs: -under,
                        ...(gainDb === undefined ? {} : { gainDb }),
                        duckDb: padDuckDb(this.config),
                    });
                } else {
                    // A STING plays alone between two takes, so nothing is underneath it to keep
                    // intelligible and `render.padLevelDb` (how far UNDER the words) does not apply.
                    // What it must not do is jump out of the script or vanish from it, so it is
                    // levelled to the words either side. A joined break is then measured and
                    // levelled as a whole, which keeps that ratio.
                    urls.push(url);
                    gains.push(padGainDb(padLoudness(pad), 0));
                }
                placed += 1;
                continue;
            }

            const take = await request.say(part.text);

            urls.push(this.signer.sign(storedAudioUrl(base, take.checksum, take.ext)));
            gains.push(undefined);
            spoken.push(take.spokenText);
        }

        // No pad actually landed, so there is nothing for a join to be FOR.
        //
        // Worth stating because the naive reading is that two takes still want joining: they do not.
        // The words were split for the sole purpose of putting a sound between them, and joining
        // them without it produces a silent hole mid-sentence where the drop should have been, out
        // of two separately-trimmed takes that no longer share their prosody. One take of the whole
        // script is strictly better, and that is what the caller falls back to.
        if (placed === 0) return undefined;

        // Two parts is the floor for a join, and an overlaid pad does not raise it: one take with a
        // drop mixed onto it is still one part, and a mixer asked to join a single file pays a decode
        // to hand the same bytes back. It IS worth the call once there is something to mix on.
        if (urls.length < 2 && overlays.length === 0) return undefined;

        const joined = await this.mixer.join(request.label, urls, padGapMs(this.config), { overlays, gainsDb: gains });
        if (joined === undefined) return undefined;

        const ext = extensionForMime(joined.mime);
        if (ext === undefined) {
            // Nothing here can serve it, and storing bytes under a guessed extension is how a
            // segment airs as silence. The stream is let go, because the plugin is holding a socket
            // open on our behalf.
            await joined.audio.cancel().catch(() => {});
            this.logger.warn('render: the joined audio came back as something the station cannot serve', {
                label: request.label,
                mime: joined.mime,
            });
            return undefined;
        }

        return { audio: joined.audio, ext, spokenText: spoken.join(' '), parts: urls.length, overlays: overlays.length };
    }
}
