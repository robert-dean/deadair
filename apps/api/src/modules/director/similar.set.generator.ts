import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import type { ArtistTrack } from '@deadair/plugin-sdk';
import { DateTime } from 'luxon';
import { Logger } from '@maroonedsoftware/logger';
import { SimilarityService } from '#modules/similarity/similarity.service.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { DISCOVER_DEFAULT, DISCOVER_KEY } from './pick.resolver.js';
import { bindsAnything, withinPeriod } from './candidates.repository.js';
import { artistKey, songKey } from './rotation.keys.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';
import { freshnessOf, historyDaysFor, resolveSmartShuffle } from './smart.shuffle.js';
import { errorText } from '#modules/shared/error.text.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';

/**
 * Programming outward from what the station has been playing.
 *
 * ## The bubble, and why this is a bias rather than a rule
 *
 * `CatalogSetGenerator` draws at random from whatever the library holds and rejects what the rules
 * forbid. Every individual choice is legal and the aggregate is a station that sounds like it owns
 * two hundred songs, because a filter has nothing to say about the far side of itself
 * ([station-intelligence](https://github.com/robert-dean/deadair/discussions/37) §5). This is one of the two answers to that: reach for acts
 * the library does NOT hold, by asking what resembles the ones it has been playing.
 *
 * ## Seeds, never a ranking
 *
 * The seeds come from recent play history, and that direction is the whole safety of it. Ranking
 * anything BY the station's own play counts is a positive feedback loop — what aired is what is
 * offered, so what is offered is what airs — which would deepen the bubble while looking like a
 * popularity feature. Using history to point outward is the opposite move: an artist appears here
 * once as a starting point and their neighbours are what comes back.
 *
 * The seeds are also deduplicated against themselves, so an evening dominated by one act does not
 * produce an hour of that act's neighbours.
 *
 * **Under a brief the seeds are this BROADCAST's records rather than the station's.** What excuses
 * this binding from `ignoresBrief` is that its seeds actually aired, so under a brief it draws from
 * the brief's own results — true while an hour has been running, and false at the moment the brief
 * changes, when play history is entirely the previous one. See {@link SimilarSetGenerator.seeds},
 * which carries what that cost on air.
 *
 * ## It names records and decides nothing
 *
 * Picks are names. `PickResolver` runs the dislike veto, the repeat window, the artist cooldown and
 * the per-artist cap over every one of them, and looks up anything the library has never held. So
 * this inherits every rule by doing nothing, exactly as the chart binding does.
 *
 * ## On by default, and inert without discovery
 *
 * `rotation.similarMix` is 0.4 unless an operator says otherwise — see {@link DEFAULT_SIMILAR_MIX}
 * for why this differs from the chart binding beside it. Set to 0 with a similarity plugin
 * installed, it says so once rather than being a capability that silently does nothing.
 *
 * The whole point is records the library does not hold, so with `rotation.discover` off nearly
 * everything this names is dropped a step later — a legitimate choice that would otherwise read as
 * a broken plugin, so that gets said once too.
 */

/** What `SetGenerator.name` reports for anything chosen here. */
export const SIMILAR_GENERATOR = 'similar';

/** The `deadair.settings` keys this binding reads. */
export const SIMILAR_GENERATOR_KEYS = {
    /** What fraction of a batch may come from a neighbour of something recently played. 0 is off. */
    mix: 'rotation.similarMix',
} as const;

/**
 * ON by default, unlike {@link DEFAULT_CHART_MIX}, and the asymmetry is the whole argument.
 *
 * A chart is a FORMAT — "this week's top forty" is a specific thing to sound like, and installing a
 * plugin for its tags should not put chart pop in an operator's evening. Similarity is a BIAS, and
 * [station-intelligence](https://github.com/robert-dean/deadair/discussions/37) §5 already calls a station that only ever draws from its own
 * library a structural defect: every individual choice is legal and the aggregate sounds like it
 * owns two hundred songs. Reaching outward is the station working properly rather than a
 * programming decision, which is the same reasoning `rotation.discover` defaults on under — off
 * makes the path inert.
 *
 * It still tops up rather than replacing, the floor still cannot fail, and every pick is judged by
 * the rules like any other. The price is that roughly this share of each refill is new to the
 * library, so it costs a provider lookup and a download apiece.
 */
export const DEFAULT_SIMILAR_MIX = 0.4;

/**
 * How many recently aired artists are used as starting points.
 *
 * Few, and the reason is spread rather than cost: every seed contributes its own neighbours, so a
 * long seed list produces a batch that is mostly one seed's world. Four gives a refill several
 * unrelated directions to have come from.
 */
const MAX_SEEDS = 4;

/** Neighbours asked for per seed. Past this the list stops resembling the seed in any useful way. */
const NEIGHBOURS_PER_SEED = 8;

/** Records asked for per neighbour. A handful, because the batch is spread across many artists. */
const TRACKS_PER_ARTIST = 3;

@Injectable()
export class SimilarSetGenerator extends SetGenerator {
    readonly name = SIMILAR_GENERATOR;

    /** Whether the "discovery is off" line has been said. Once per process; see the chart binding. */
    private warnedAboutDiscovery = false;

    /** Whether the "installed but switched off" line has been said. Once per process, as above. */
    private saidItWasInert = false;

    constructor(
        private readonly similarity: SimilarityService,
        private readonly history: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {
        super();
    }

    async generate(inputs: SetInputs): Promise<TrackPick[]> {
        if (inputs.count <= 0) return [];

        const mix = readMix(this.config.get(SIMILAR_GENERATOR_KEYS.mix, DEFAULT_SIMILAR_MIX));
        if (mix === 0) {
            this.sayIfInert();
            return [];
        }

        // Both halves are required and they are different questions: something has to say who
        // resembles whom, and something has to turn a name into a record. A plugin that only does
        // the first can inform a DJ through the tool and cannot programme an hour here.
        if (!this.similarity.hasSimilarity()) {
            this.logger.debug('director: the similar mix is set but no plugin can say who resembles whom');
            return [];
        }
        if (!this.similarity.canNameTracks()) {
            this.logger.debug('director: a similarity plugin is installed but none of them can name records by an artist');
            return [];
        }

        if (!this.discovering() && !this.warnedAboutDiscovery) {
            this.warnedAboutDiscovery = true;
            this.logger.warn(
                'director: the similar mix is set but "rotation.discover" is off, so neighbours the library does not already hold cannot air',
            );
        }

        const want = Math.max(1, Math.round(inputs.count * mix));

        const seeds = await this.seeds(inputs);
        if (seeds.length === 0) {
            // The ordinary state on a station that has just gone on air for the first time, rather
            // than a fault: there is nothing to be similar TO yet. It fixes itself after one record.
            this.logger.debug('director: nothing has aired yet, so there is nothing to find neighbours for');
            return [];
        }

        // Which of a neighbour's top tracks aired lately, so the walk can take a fresher one. Read once
        // per refill, after the seeds, so a station with nothing aired yet pays nothing. Off, it asks
        // for zero days and runs no query, and the walk takes each neighbour's first track as before.
        const smartShuffle = resolveSmartShuffle(this.config);
        const lastAired = await this.history.lastAiredSince(historyDaysFor(smartShuffle), this.identity.stationKey).catch((error: unknown) => {
            // A lean is not worth this binding's share of the batch. Without the history the walk
            // is the one it was before smart shuffle existed, which is a fine answer.
            this.logger.debug(
                `director: the similarity walk could not read what aired lately, so it takes each neighbour's first track (${errorText(error)})`,
            );
            return new Map<string, DateTime>();
        });
        const now = DateTime.utc();
        const freshness = (song: string): number => freshnessOf(lastAired.get(song), now, smartShuffle.horizonDays);

        const picks: TrackPick[] = [];
        const takenSongs = new Set(inputs.avoidSongKeys ?? []);
        const takenArtists = new Set<string>();
        // Absent unless the broadcast named one, and `bindsAnything` is what tells a window with no
        // ends set apart from a real bound.
        const era = bindsAnything(inputs.era) ? inputs.era : undefined;

        try {
            // Seed at a time rather than gathering every neighbour first, so a batch that fills
            // early stops making upstream calls. Round-robin across seeds is deliberately NOT done:
            // a seed's best neighbour is a better pick than another seed's fourth, and the spread
            // comes from having several seeds at all.
            for (const seed of seeds) {
                if (picks.length >= want) break;

                for (const neighbour of await this.similarity.similarTo({ name: seed }, NEIGHBOURS_PER_SEED)) {
                    if (picks.length >= want) break;

                    // One record per artist within a batch. The per-artist cap downstream would
                    // catch this, but spending the upstream calls first and having them rejected
                    // is the same batch for more requests.
                    const neighbourKey = artistKey([neighbour.name]);
                    if (takenArtists.has(neighbourKey)) continue;
                    takenArtists.add(neighbourKey);

                    const tracks = await this.similarity.topTracks(
                        { name: neighbour.name, ...(neighbour.mbid === undefined ? {} : { mbid: neighbour.mbid }) },
                        TRACKS_PER_ARTIST,
                    );

                    // Every track of this neighbour's that could be named, in the order the source
                    // ranked them. The walk then takes ONE, as it always has.
                    const eligible: { track: ArtistTrack; song: string }[] = [];
                    for (const track of tracks) {
                        const song = songKey(track.title, [track.artist]);
                        if (takenSongs.has(song)) continue;

                        // The PERIOD, applied here rather than left to the resolver, and the
                        // difference is not efficiency. `PickResolver` drops an out-of-period pick
                        // whatever named it, so handing one over converts this binding's share of
                        // the batch into NOTHING — where declining to name it lets
                        // `SetGeneratorChain` top up from `CatalogSetGenerator`, which narrows on
                        // the same period in SQL and can actually fill the slot. **A short answer
                        // from here is strictly better than a doomed full one.**
                        //
                        // It is needed at all because the argument that excuses this binding from
                        // `ignoresBrief` does not stretch this far. That argument is that its seeds
                        // are records which actually aired, so under a brief it draws from the
                        // brief's own results — true, and much weaker for a period than for a
                        // style: a neighbour of a 1975 record is stylistically close and easily
                        // from 1998. It skews in-period without landing in it.
                        //
                        // An unknown year passes, exactly as it does in the draw and at the
                        // resolver. All three have to agree or a record is eligible in one place
                        // and not another.
                        if (era !== undefined && !withinPeriod(track.year, era)) continue;

                        eligible.push({ track, song });
                    }

                    const chosen = freshestFirst(eligible, entry => freshness(entry.song));
                    if (chosen === undefined) continue;

                    takenSongs.add(chosen.song);
                    // No `trackId`: this has not read the catalog. The resolver matches by name,
                    // which is the one place that decision belongs.
                    picks.push({ title: chosen.track.title, artist: chosen.track.artist });
                }
            }
        } catch (error) {
            // The chain absorbs a throw anyway. Caught here so whatever was already gathered is
            // kept — a partial answer is a good answer, and the records above cost real calls.
            this.logger.warn(`director: the similarity walk stopped early (${errorText(error)})`);
        }

        this.logger.debug('director: took records from neighbours of what has aired', {
            seeds: seeds.length,
            want,
            named: picks.length,
            ...(era === undefined ? {} : { era }),
        });
        return picks;
    }

    /**
     * What to find neighbours of: the artists most recently aired.
     *
     * Recent rather than most-played, and that is the load-bearing word. See the note on
     * {@link PlayHistoryRepository.recentArtists}: a frequency ranking here would make the station
     * orbit whatever it already orbits.
     */
    private async seeds(inputs: SetInputs): Promise<string[]> {
        // Under a brief, only THIS broadcast's own records may seed.
        //
        // The paragraph at the top of this file argues that seeding from what aired is safe under a
        // brief because "it draws from the brief's own results", and that is what excuses this
        // binding from `ignoresBrief`. It holds in the steady state and fails at exactly one moment:
        // the one where the brief CHANGES. Play history is then entirely the PREVIOUS brief, and
        // this extrapolates from it confidently — which is the only moment anybody is listening for
        // the difference, because it is the moment they asked for one.
        //
        // Measured on the live station, 2026-08-31: a station asked for "Artists like Mitch murder"
        // opened with thirteen thrash records. The model had found Mitch Murder's neighbours and
        // died mid-answer; this filled all fourteen slots from Exodus, Testament and Kreator, which
        // is what the last brief had been playing. `rotation.briefOnly` was ON and did not stop it,
        // because that switch reads `ignoresBrief` and this binding declares it false.
        //
        // Narrowing rather than declaring `ignoresBrief` keeps what the excuse was actually for: a
        // briefed hour that has been running a while still reaches outward from its own records,
        // which is the bubble-breaking this binding exists to do. It only stops borrowing the
        // previous programme's taste to do it.
        //
        // With no broadcast to scope to, a briefed station seeds NOTHING rather than falling back to
        // the station-wide read. That read is the bug, so reaching for it as a fallback would
        // reintroduce it in the one case this cannot see; a short answer here is what the chain
        // already handles, and `rotation.briefOnly` is where an operator says whether silence beats
        // an off-brief record.
        const briefed = (inputs.brief ?? '').trim().length > 0;
        const broadcast = this.identity.current();
        if (briefed && broadcast === undefined) {
            this.logger.debug('director: no broadcast to draw neighbours from, and a brief is in force, so none are offered');
            return [];
        }

        try {
            return await this.history.recentArtists(MAX_SEEDS, this.identity.stationKey, briefed ? broadcast : undefined);
        } catch (error) {
            this.logger.warn(`director: could not read what has been playing (${errorText(error)})`);
            return [];
        }
    }

    /**
     * Say, once, that a capability the operator installed is switched off here.
     *
     * The gap this closes: a plugin declaring `similarity` shows up as an active capability on the
     * console with nothing anywhere saying the station is not asking it for anything. An operator
     * who set the mix to 0 deliberately gets one line per process and never hears about it again;
     * one who never knew the setting existed gets told where to look.
     *
     * Only when something could actually have answered, so a station with no similarity plugin
     * stays silent about a setting that would do nothing for it either way.
     */
    private sayIfInert(): void {
        if (this.saidItWasInert || !this.similarity.hasSimilarity()) return;
        this.saidItWasInert = true;
        this.logger.info(
            `director: a similarity plugin is installed but "${SIMILAR_GENERATOR_KEYS.mix}" is 0, so the station is asking it for nothing`,
        );
    }

    /** Whether a record outside the library can reach the air at all. Only decides whether to warn. */
    private discovering(): boolean {
        return settingIsOn(this.config, DISCOVER_KEY, DISCOVER_DEFAULT);
    }
}

/** The mix as a fraction between 0 and 1. See the chart binding for why a non-number is 0. */
function readMix(value: unknown): number {
    const mix = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(mix) || mix <= 0) return 0;
    return Math.min(mix, 1);
}

/**
 * The freshest of a neighbour's eligible tracks, ties going to the one the source ranked higher.
 *
 * What makes the similarity walk a smart shuffle too. It used to take each neighbour's first track,
 * and a neighbour's first track is the same record every time that neighbour comes up: measured on the
 * live station on 2026-09-12, the most-aired records of the fortnight were canonical hits aired five to
 * seven times each. Choosing the freshest of the few the source offers keeps the neighbour and changes
 * the record, and it drops nothing: the neighbour still contributes one.
 *
 * A ranking by freshness rather than a weighted draw, deliberately, and it is a choice between three
 * rather than a sort of the library. The source's own order is a real signal (its best-known track
 * first), so with nothing aired lately the answer is exactly the old one; a draw would spend that
 * signal even when there was no repetition to avoid.
 */
const freshestFirst = <T>(eligible: readonly T[], freshnessOf: (entry: T) => number): T | undefined => {
    let best: T | undefined;
    let bestFreshness = -1;
    for (const entry of eligible) {
        const freshness = freshnessOf(entry);
        if (freshness > bestFreshness) {
            best = entry;
            bestFreshness = freshness;
        }
    }
    return best;
};
