import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ANALYSIS_SCHEMA_VERSION } from '@deadair/plugin-sdk';
import { AnalysisRepository, type StoredAnalysis } from '#modules/analysis/analysis.repository.js';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import type { MeasuredLoudness } from '#modules/playout/gain.js';
import type { RundownTrack } from '#modules/playout/rundown.js';
import { CandidatesRepository } from './candidates.repository.js';
import type { TrackPick } from './set.generator.js';

/**
 * The measured cue points as an item carries them, or nothing.
 *
 * Snapshotted onto the item rather than read at hand-over, which is the same
 * call `durationMs` and `artworkUrl` already make. The consequence is stated on
 * `RundownItem`: a track measured after it enters a running order airs untrimmed
 * until that order is rebuilt, which is what the station does today anyway.
 *
 * The numbers are validated once more here even though the repository filtered
 * the rows, because `data` is a jsonb blob written by a plugin: the host stores
 * it unread on purpose, so this is the first place anything looks inside it.
 */
function cuePoints(analysis: StoredAnalysis | undefined): { cueInMs?: number; cueOutMs?: number } {
    const cueInMs = analysis?.data.cueIn;
    const cueOutMs = analysis?.data.cueOut;

    if (typeof cueInMs !== 'number' || typeof cueOutMs !== 'number') return {};
    if (!Number.isFinite(cueInMs) || !Number.isFinite(cueOutMs)) return {};
    if (cueInMs < 0 || cueOutMs <= cueInMs) return {};

    return { cueInMs, cueOutMs };
}

/**
 * The measured loudness as an item carries it, field by field.
 *
 * Unlike {@link cuePoints}, which are all-or-nothing because a cue span that is
 * half measured describes nothing, these are independent: an analyzer may report
 * a loudness and no peak, and `gainFor` has a defined answer for every
 * combination including none of them. So each field is taken on its own and a
 * bad one costs only itself.
 *
 * Validated here for the same reason the cue points are: `data` is a jsonb blob
 * a plugin wrote and the host stored without reading, so this is the first place
 * anything looks inside it.
 */
function loudness(analysis: StoredAnalysis | undefined): MeasuredLoudness {
    const data = analysis?.data;
    // `integratedLufs` is the analyzer's name for it and `loudnessLufs` is the
    // item's; this line is the whole of that translation.
    const loudnessLufs = measurement(data?.integratedLufs);
    const truePeakDb = measurement(data?.truePeakDb);
    const samplePeakDb = measurement(data?.samplePeakDb);

    return {
        ...(loudnessLufs === undefined ? {} : { loudnessLufs }),
        ...(truePeakDb === undefined ? {} : { truePeakDb }),
        ...(samplePeakDb === undefined ? {} : { samplePeakDb }),
    };
}

const measurement = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * Turning a chosen track into something the station can actually air.
 *
 * A pick names a work; a lineup item has to name a COPY, because that is what
 * the player is eventually handed — `pluginId` + `externalId`, which is the key
 * of `deadair.track_sources`. This is the step between, and it is where a pick
 * that nothing can play is dropped rather than becoming a gap on the mount.
 *
 * Two rungs today:
 *
 *   1. The pick carries a canonical id (everything the catalog generator picks),
 *      or its title and artist match a catalog row.
 *   2. Neither: the pick is discarded and logged.
 *
 * A third rung — asking the providers to search for a name the catalog has never
 * seen — is deliberately absent. It only matters once something is naming tracks
 * from outside the library, which is an LLM DJ's problem and not this one's, and
 * a bad match there airs the wrong record rather than failing visibly. The shape
 * here leaves room for it: nothing above this cares how a pick became a copy.
 */
@Injectable()
export class PickResolver {
    constructor(
        private readonly candidates: CandidatesRepository,
        private readonly tracks: TracksRepository,
        private readonly analysis: AnalysisRepository,
        private readonly logger: Logger,
    ) {}

    /**
     * Resolve a batch of picks, in order, dropping what cannot be played.
     *
     * Batched because the two lookups behind it are: one query for the bindings
     * and one for the display metadata, however many picks there are. A refill of
     * fifteen tracks costs the same as one.
     *
     * @param preference - Plugin ids in the operator's order, for a work several
     *   providers can serve.
     */
    async resolve(picks: readonly TrackPick[], preference: readonly string[] = []): Promise<RundownTrack[]> {
        if (picks.length === 0) return [];

        const identified = await this.identify(picks);
        if (identified.length === 0) return [];

        const trackIds = identified.map(entry => entry.trackId);
        // A third batch query alongside the two that were already here, so a refill of
        // fifteen tracks still costs three round trips rather than three per track.
        // `trustedAnalysisFor` has already dropped anything not worth acting on -- a
        // failure, a partial file, an older schema version -- so a miss here and an
        // unmeasured track are the same thing to the code below, which is the point.
        const [bindings, metadata, measured] = await Promise.all([
            this.candidates.bindingsFor(trackIds, preference),
            this.tracks.findByIds(trackIds),
            this.analysis.trustedAnalysisFor(trackIds, ANALYSIS_SCHEMA_VERSION),
        ]);

        const resolved: RundownTrack[] = [];
        for (const { pick, trackId } of identified) {
            const binding = bindings.get(trackId);
            if (!binding) {
                // Every provider that carried it has stopped. The catalog still knows the
                // work; nothing can play it, so it is one track skipped rather than a gap.
                this.logger.warn('director: no provider still serves a chosen track; skipping it', {
                    track: `${pick.artist} — ${pick.title}`,
                });
                continue;
            }

            const row = metadata.get(trackId);
            resolved.push({
                pluginId: binding.pluginId,
                externalId: binding.externalId,
                title: row?.title ?? pick.title,
                // The credit as written on the release when the catalog has it, because that
                // is what a listener sees; the pick's `artist` is an identity, not a display.
                artists: row?.credit ? [row.credit] : [pick.artist],
                ...(binding.durationMs === undefined ? {} : { durationMs: binding.durationMs }),
                ...(row?.album == null ? {} : { album: row.album }),
                ...(row?.artworkUrl == null ? {} : { artworkUrl: row.artworkUrl }),
                ...(row?.year == null ? {} : { year: row.year }),
                ...cuePoints(measured.get(trackId)),
                ...loudness(measured.get(trackId)),
                trackId,
            });
        }
        return resolved;
    }

    /**
     * Attach a canonical id to every pick that has one, keeping the order.
     *
     * A pick that already carries an id is taken at its word: it came from the
     * catalog a moment ago. Only a named pick costs a lookup, and those are looked
     * up one at a time because there is no batch form of "match this title under
     * this artist" that stays as strict as the single one.
     */
    private async identify(picks: readonly TrackPick[]): Promise<{ pick: TrackPick; trackId: string }[]> {
        const identified: { pick: TrackPick; trackId: string }[] = [];

        for (const pick of picks) {
            const trackId = pick.trackId ?? (await this.candidates.findByName(pick.title, pick.artist));
            if (!trackId) {
                this.logger.warn('director: a chosen track is not in the catalog; skipping it', {
                    track: `${pick.artist} — ${pick.title}`,
                });
                continue;
            }
            identified.push({ pick, trackId });
        }
        return identified;
    }
}
