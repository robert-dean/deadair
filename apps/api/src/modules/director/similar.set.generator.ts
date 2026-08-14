import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { SimilarityService } from '#modules/similarity/similarity.service.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { DISCOVER_DEFAULT, DISCOVER_KEY } from './pick.resolver.js';
import { artistKey, songKey } from './rotation.keys.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * Programming outward from what the station has been playing.
 *
 * ## The bubble, and why this is a bias rather than a rule
 *
 * `CatalogSetGenerator` draws at random from whatever the library holds and rejects what the rules
 * forbid. Every individual choice is legal and the aggregate is a station that sounds like it owns
 * two hundred songs, because a filter has nothing to say about the far side of itself
 * (`docs/todo/station-intelligence.md` §5). This is one of the two answers to that: reach for acts
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
 * ## It names records and decides nothing
 *
 * Picks are names. `PickResolver` runs the dislike veto, the repeat window, the artist cooldown and
 * the per-artist cap over every one of them, and looks up anything the library has never held. So
 * this inherits every rule by doing nothing, exactly as the chart binding does.
 *
 * ## Off by default, and inert without discovery
 *
 * `rotation.similarMix` is 0 until an operator sets it. And the whole point is records the library
 * does not hold, so with `rotation.discover` off nearly everything this names is dropped a step
 * later — a legitimate choice that would otherwise read as a broken plugin, so it says so once.
 */

/** What `SetGenerator.name` reports for anything chosen here. */
export const SIMILAR_GENERATOR = 'similar';

/** The `deadair.settings` keys this binding reads. */
export const SIMILAR_GENERATOR_KEYS = {
    /** What fraction of a batch may come from a neighbour of something recently played. 0 is off. */
    mix: 'rotation.similarMix',
} as const;

/** Off, so that installing a similarity plugin changes no hour until somebody asks. */
export const DEFAULT_SIMILAR_MIX = 0;

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
        if (mix === 0) return [];

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

        const seeds = await this.seeds();
        if (seeds.length === 0) {
            // The ordinary state on a station that has just gone on air for the first time, rather
            // than a fault: there is nothing to be similar TO yet. It fixes itself after one record.
            this.logger.debug('director: nothing has aired yet, so there is nothing to find neighbours for');
            return [];
        }

        const picks: TrackPick[] = [];
        const takenSongs = new Set(inputs.avoidSongKeys ?? []);
        const takenArtists = new Set<string>();

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

                    for (const track of tracks) {
                        const song = songKey(track.title, [track.artist]);
                        if (takenSongs.has(song)) continue;

                        takenSongs.add(song);
                        // No `trackId`: this has not read the catalog. The resolver matches by name,
                        // which is the one place that decision belongs.
                        picks.push({ title: track.title, artist: track.artist });
                        break;
                    }
                }
            }
        } catch (error) {
            // The chain absorbs a throw anyway. Caught here so whatever was already gathered is
            // kept — a partial answer is a good answer, and the records above cost real calls.
            this.logger.warn(`director: the similarity walk stopped early (${errorText(error)})`);
        }

        this.logger.debug('director: took records from neighbours of what has aired', { seeds: seeds.length, want, named: picks.length });
        return picks;
    }

    /**
     * What to find neighbours of: the artists most recently aired.
     *
     * Recent rather than most-played, and that is the load-bearing word. See the note on
     * {@link PlayHistoryRepository.recentArtists}: a frequency ranking here would make the station
     * orbit whatever it already orbits.
     */
    private async seeds(): Promise<string[]> {
        try {
            return await this.history.recentArtists(MAX_SEEDS, this.identity.stationKey);
        } catch (error) {
            this.logger.warn(`director: could not read what has been playing (${errorText(error)})`);
            return [];
        }
    }

    /** Whether a record outside the library can reach the air at all. Only decides whether to warn. */
    private discovering(): boolean {
        return this.config.get(DISCOVER_KEY, DISCOVER_DEFAULT);
    }
}

/** The mix as a fraction between 0 and 1. See the chart binding for why a non-number is 0. */
function readMix(value: unknown): number {
    const mix = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(mix) || mix <= 0) return 0;
    return Math.min(mix, 1);
}
