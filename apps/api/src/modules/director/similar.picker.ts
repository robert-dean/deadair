import { Injectable } from 'injectkit';
import type { ArtistTrack } from '@deadair/plugin-sdk';
import { SimilarityService } from '#modules/similarity/similarity.service.js';
import { withinPeriod, type EraWindow } from './candidates.repository.js';
import { artistKey, songKey } from './rotation.keys.js';
import type { TrackPick } from './set.generator.js';

/**
 * The walk from an artist to records by the artists who sound like them.
 *
 * Lifted out of `SimilarSetGenerator` so that a second caller can walk from a DIFFERENT seed. The
 * generator seeds from what the station aired lately; a playlist mixing in its neighbours seeds from
 * the playlist's own records. Everything between a seed and a named record is the same question
 * either way, so it is answered once, here.
 *
 * It names records and decides nothing, exactly as the generator never did: `PickResolver` runs the
 * dislike veto and every rotation rule over whatever comes out of this.
 */

/** Neighbours asked for per seed. Past this the list stops resembling the seed in any useful way. */
const NEIGHBOURS_PER_SEED = 8;

/** Records asked for per neighbour. A handful, because the batch is spread across many artists. */
const TRACKS_PER_ARTIST = 3;

/**
 * What a walk has already decided, carried across the seeds of one batch.
 *
 * Mutated as the walk goes, and that is the point of it: a caller walking several seeds hands the
 * same one to each, so a neighbour taken for the first seed is not taken again for the second.
 */
export interface NeighbourWalk {
    /** Songs not to name: what the order already holds, plus everything this walk has named. */
    takenSongs: Set<string>;
    /** Artists already given a record in this batch. One each, so a batch spreads. */
    takenArtists: Set<string>;
    /** The broadcast's period, when it has one with at least one end set. */
    era?: EraWindow;
    /** How fresh a song is, from 0 (just aired) to 1. Always 1 with smart shuffle off. */
    freshness: (song: string) => number;
}

@Injectable()
export class SimilarPicker {
    constructor(private readonly similarity: SimilarityService) {}

    /**
     * Up to `want` records by the neighbours of `seed`, one per neighbour, best neighbour first.
     *
     * Appended to `into` as each is found rather than returned at the end, so a caller that catches
     * a throw part way keeps what was gathered. A partial answer is a good one here: every record
     * above cost real upstream calls.
     *
     * @returns `into`, for a caller that had nothing to append to.
     */
    async pickFromNeighbours(seed: string, want: number, walk: NeighbourWalk, into: TrackPick[] = []): Promise<TrackPick[]> {
        const target = into.length + want;
        if (want <= 0) return into;

        for (const neighbour of await this.similarity.similarTo({ name: seed }, NEIGHBOURS_PER_SEED)) {
            if (into.length >= target) break;

            // One record per artist within a batch. The per-artist cap downstream would catch this,
            // but spending the upstream calls first and having them rejected is the same batch for
            // more requests.
            const neighbourKey = artistKey([neighbour.name]);
            if (walk.takenArtists.has(neighbourKey)) continue;
            walk.takenArtists.add(neighbourKey);

            const tracks = await this.similarity.topTracks(
                { name: neighbour.name, ...(neighbour.mbid === undefined ? {} : { mbid: neighbour.mbid }) },
                TRACKS_PER_ARTIST,
            );

            const chosen = freshestFirst(eligibleOf(tracks, walk), entry => walk.freshness(entry.song));
            if (chosen === undefined) continue;

            walk.takenSongs.add(chosen.song);
            // No `trackId`: this has not read the catalog. The resolver matches by name, which is
            // the one place that decision belongs.
            into.push({ title: chosen.track.title, artist: chosen.track.artist });
        }
        return into;
    }

    /**
     * One record that sounds like this RECORD, appended to `into`, or nothing.
     *
     * Asks the record-level question first where a plugin can answer it, because a neighbour chosen
     * from the record itself is closer to what a listener just heard than one chosen from its
     * artist: an artist's neighbour is only as close as their best known track happens to be. Takes
     * the freshest record by an artist the walk has not already given one, ties to the source's own
     * ranking, on {@link pickFromNeighbours}' rules. With no such plugin, or nothing it offered
     * usable, it walks the anchor's artist instead, which is every station before this existed.
     */
    async pickLike(anchor: { title: string; artist: string }, walk: NeighbourWalk, into: TrackPick[] = []): Promise<TrackPick[]> {
        if (this.similarity.canNameSimilarTracks()) {
            const tracks = await this.similarity.similarTracks({ artist: anchor.artist, title: anchor.title }, SIMILAR_TRACKS_PER_RECORD);
            const eligible = eligibleOf(tracks, walk).filter(entry => !walk.takenArtists.has(artistKey([entry.track.artist])));
            const chosen = freshestFirst(eligible, entry => walk.freshness(entry.song));

            if (chosen !== undefined) {
                walk.takenSongs.add(chosen.song);
                walk.takenArtists.add(artistKey([chosen.track.artist]));
                into.push({ title: chosen.track.title, artist: chosen.track.artist });
                return into;
            }
        }
        return await this.pickFromNeighbours(anchor.artist, 1, walk, into);
    }
}

/**
 * Records asked for that sound like one record. More than a neighbour's top tracks, because the
 * answer is spread across many artists and most of them are already on the playlist.
 */
const SIMILAR_TRACKS_PER_RECORD = 10;

/**
 * Every track of a neighbour's that could be named, in the order the source ranked them.
 *
 * The PERIOD is applied here rather than left to the resolver, and the difference is not efficiency.
 * `PickResolver` drops an out-of-period pick whatever named it, so naming one converts the caller's
 * share of the batch into NOTHING, where declining to name it lets `SetGeneratorChain` top up from
 * `CatalogSetGenerator`, which narrows on the same period in SQL and can actually fill the slot. **A
 * short answer from here is strictly better than a doomed full one.**
 *
 * It is needed at all because a neighbour of a 1975 record is stylistically close and easily from
 * 1998: seeding from in-period records skews in-period without landing in it.
 *
 * An unknown year passes, exactly as it does in the draw and at the resolver. All three have to agree
 * or a record is eligible in one place and not another.
 */
const eligibleOf = (tracks: readonly ArtistTrack[], walk: NeighbourWalk): { track: ArtistTrack; song: string }[] => {
    const eligible: { track: ArtistTrack; song: string }[] = [];
    for (const track of tracks) {
        const song = songKey(track.title, [track.artist]);
        if (walk.takenSongs.has(song)) continue;
        if (walk.era !== undefined && !withinPeriod(track.year, walk.era)) continue;
        eligible.push({ track, song });
    }
    return eligible;
};

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
