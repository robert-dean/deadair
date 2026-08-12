import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ANALYSIS_SCHEMA_VERSION } from '@deadair/plugin-sdk';
import { AnalysisRepository, type StoredAnalysis } from '#modules/analysis/analysis.repository.js';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import type { MeasuredLoudness } from '#modules/playout/gain.js';
import type { RundownTrack } from '#modules/playout/rundown.js';
import { CandidatesRepository } from './candidates.repository.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { artistKey, songKey } from './rotation.keys.js';
import { applyRules, spaceArtists, type ResolvedRules, type RotationCandidate } from './rotation.rules.js';
import type { TrackPick } from './set.generator.js';

/** The four cue points as an item carries them: all of them, or none. */
type CuePointSnapshot = { cueInMs?: number; introEndMs?: number; outroStartMs?: number; cueOutMs?: number };

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
 *
 * **All four or none**, which is stricter than it needs to be for the outer two
 * and is the right call anyway. The trim only needs `cueIn` and `cueOut`, so a
 * blob with a bad `introEnd` could still trim — but the four points describe one
 * shape, and a measurement that contradicts itself about where a record is
 * underway is not one to trust about where it stops either. An unmeasured track
 * plays untrimmed, which is an ordinary state and not a fault.
 *
 * The ordering check is the whole chain rather than the ends. `measure.py` clamps
 * its output into this order before it answers, so a violation arriving here is
 * not a detector being imprecise: it is a blob from something else.
 */
function cuePoints(analysis: StoredAnalysis | undefined): CuePointSnapshot {
    const cueInMs = analysis?.data.cueIn;
    const introEndMs = analysis?.data.introEnd;
    const outroStartMs = analysis?.data.outroStart;
    const cueOutMs = analysis?.data.cueOut;

    const points = [cueInMs, introEndMs, outroStartMs, cueOutMs];
    if (points.some(point => typeof point !== 'number' || !Number.isFinite(point))) return {};
    if (cueInMs! < 0 || cueOutMs! <= cueInMs!) return {};
    // Non-strict between the inner points: a record with no intro to speak of, or one
    // that ends the instant its outro begins, is a real record rather than a bad blob.
    if (introEndMs! < cueInMs! || outroStartMs! < introEndMs! || cueOutMs! < outroStartMs!) return {};

    return { cueInMs, introEndMs, outroStartMs, cueOutMs };
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
    const loudnessLufs = taggedLoudness(data) ?? measurement(data?.integratedLufs);
    const truePeakDb = measurement(data?.truePeakDb);
    const samplePeakDb = measurement(data?.samplePeakDb);

    return {
        ...(loudnessLufs === undefined ? {} : { loudnessLufs }),
        ...(truePeakDb === undefined ? {} : { truePeakDb }),
        ...(samplePeakDb === undefined ? {} : { samplePeakDb }),
    };
}

/**
 * How loud the FILE says it is, from its own ReplayGain or R128 tags.
 *
 * Preferred over the measurement where a file carries it, which is the rule
 * `docs/todo/station-intelligence.md` §4 states and the reason for it is not
 * accuracy: a tag is what the mastering engineer or the label decided, and the
 * measurement is what this station guessed. Where they disagree the station is
 * not the authority.
 *
 * **This is the only place the preference is expressed**, so an item carries one
 * loudness and everything downstream is spared knowing where it came from. The
 * blob keeps both.
 *
 * The tagged PEAK is deliberately not preferred anywhere: it is a sample peak by
 * definition, and the measurement has a true one, which is the number a boost is
 * actually capped against.
 */
function taggedLoudness(data: StoredAnalysis['data'] | undefined): number | undefined {
    const gainDb = measurement(data?.tagGainDb);
    const referenceLufs = measurement(data?.tagReferenceLufs);
    // Both or neither. A gain with no reference is not a weaker claim about the
    // record's level, it is no claim at all -- the two conventions in the wild
    // are five decibels apart -- so an incomplete pair falls through to the
    // measurement rather than being read against an assumed reference here.
    if (gainDb === undefined || referenceLufs === undefined) return undefined;

    return referenceLufs - gainDb;
}

const measurement = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * A pick that has been matched to a catalog row, carrying what the rules judge it by.
 *
 * The keys are computed once, here, through the same helpers `play_history` is written with, rather
 * than recomputed at each rule. A rotation rule that silently never matches has no symptom except a
 * station that repeats itself, so the fewer places these are derived the better.
 */
interface Identified extends RotationCandidate {
    pick: TrackPick;
    trackId: string;
}

/** A resolved track with its keys still attached, so the last rule can be applied to it. */
type Airable = RundownTrack & RotationCandidate;

/** Drop the keys again. They are a rotation concern and a rundown item has no business carrying them. */
const toRundownTrack = ({ songKey: _song, artistKey: _artist, rating: _rating, ...track }: Airable): RundownTrack => track;

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
 *
 * ## It is also where the rotation rules are enforced, and that is not tidiness
 *
 * The rules used to live inside `CatalogSetGenerator` alone, which was correct
 * exactly as long as it was the only generator. It is not: a {@link SetGenerator}
 * pick is a NAME, so any second binding — a model, an operator's request, a
 * plugin that programmes the station — hands over titles that nothing has judged.
 * A dislike is documented as an INSTRUCTION that no lineup may turn off, so a
 * generator able to route around it is a correctness hole rather than a matter of
 * taste.
 *
 * So the rules are applied HERE, at the one step every pick from every source
 * passes through on its way to becoming something airable. `CatalogSetGenerator`
 * still filters before its own draw and that is not redundant: filtering early is
 * what makes the draw efficient, and filtering here is what makes it guaranteed.
 * **Do not delete either one on the grounds that the other exists.**
 *
 * The one rule applied after the drops rather than before them is
 * {@link spaceArtists}, because spacing a batch and then removing two of its
 * tracks closes the gap back up. See {@link applyRules}.
 */
@Injectable()
export class PickResolver {
    constructor(
        private readonly candidates: CandidatesRepository,
        private readonly tracks: TracksRepository,
        private readonly analysis: AnalysisRepository,
        private readonly history: PlayHistoryRepository,
        private readonly logger: Logger,
    ) {}

    /**
     * Resolve a batch of picks, in order, dropping what cannot be played.
     *
     * Batched because the two lookups behind it are: one query for the bindings
     * and one for the display metadata, however many picks there are. A refill of
     * fifteen tracks costs the same as one.
     *
     * @param rules - The rules in force for the lineup these picks are for, which
     *   every pick is judged against here whatever chose it.
     * @param preference - Plugin ids in the operator's order, for a work several
     *   providers can serve.
     */
    async resolve(picks: readonly TrackPick[], rules: ResolvedRules, preference: readonly string[] = []): Promise<RundownTrack[]> {
        if (picks.length === 0) return [];

        const identified = await this.identify(picks);
        if (identified.length === 0) return [];

        const eligible = await this.judge(identified, rules);
        if (eligible.length === 0) return [];

        const trackIds = eligible.map(entry => entry.trackId);
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

        const resolved: Airable[] = [];
        for (const { pick, trackId, artistKey: artist, songKey: song } of eligible) {
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
                artistKey: artist,
                songKey: song,
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

        // Last, and only now that every drop above has happened. Spacing a batch and then
        // removing two of its tracks closes the gap back up and puts one artist back on its
        // own heels, which is the one thing this rule exists to prevent.
        return spaceArtists(resolved).map(toRundownTrack);
    }

    /**
     * Drop everything the rules say may not air, whatever named it.
     *
     * Two reads, both of which {@link CatalogSetGenerator} also makes and neither of which can be
     * shared with it: a generator that never touched the catalog has produced no ratings, and the
     * windows move — a refill that ran a minute ago has itself changed the answer, which is why they
     * are read at judging time rather than passed in.
     *
     * A pick the catalog has no rating row for is KEPT. `identify` has already established the track
     * exists, so a missing rating is a join that found no album rather than a record nobody has an
     * opinion about, and dropping on it would silently refuse tracks for having no artwork.
     */
    private async judge(identified: readonly Identified[], rules: ResolvedRules): Promise<Identified[]> {
        const [ratings, songKeys, artistKeys] = await Promise.all([
            this.candidates.ratingsFor(identified.map(entry => entry.trackId)),
            this.history.songKeysSince(rules.repeatWindowDays),
            this.history.artistKeysSince(rules.artistCooldownMinutes),
        ]);

        const judged = identified.map(entry => {
            const rating = ratings.get(entry.trackId);
            return rating === undefined ? entry : { ...entry, rating };
        });

        const eligible = applyRules(judged, rules, { songKeys, artistKeys });
        if (eligible.length < identified.length) {
            this.logger.debug('director: the rotation rules dropped some chosen tracks', {
                offered: identified.length,
                kept: eligible.length,
            });
        }
        return eligible;
    }

    /**
     * Attach a canonical id to every pick that has one, keeping the order.
     *
     * A pick that already carries an id is taken at its word: it came from the
     * catalog a moment ago. Only a named pick costs a lookup, and those are looked
     * up one at a time because there is no batch form of "match this title under
     * this artist" that stays as strict as the single one.
     */
    private async identify(picks: readonly TrackPick[]): Promise<Identified[]> {
        const identified: Identified[] = [];

        for (const pick of picks) {
            const trackId = pick.trackId ?? (await this.candidates.findByName(pick.title, pick.artist));
            if (!trackId) {
                this.logger.warn('director: a chosen track is not in the catalog; skipping it', {
                    track: `${pick.artist} — ${pick.title}`,
                });
                continue;
            }
            identified.push({
                pick,
                trackId,
                // Off the PICK's own strings rather than the catalog row's, which matches how
                // `CatalogSetGenerator` keys its candidates and how `play_history` is written: the
                // lead artist is what identity is taken from, never the credit line.
                songKey: songKey(pick.title, [pick.artist]),
                artistKey: artistKey([pick.artist]),
            });
        }
        return identified;
    }
}
