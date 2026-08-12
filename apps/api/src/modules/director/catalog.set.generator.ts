import { Injectable } from 'injectkit';
import { CandidatesRepository, type CandidateTrack } from './candidates.repository.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { artistKey, songKey } from './rotation.keys.js';
import { applyRules, spaceArtists, weightOf, type RotationCandidate } from './rotation.rules.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';

/**
 * The station's own taste, for now: a weighted draw from the catalog, shaped by
 * the rotation rules.
 *
 * Deterministic in the sense that matters — it makes no network call, needs no
 * model, and cannot fail in a way that takes the station off air. It is the
 * implementation the {@link SetGenerator} seam exists to be replaceable ahead of,
 * and the seam is what an LLM DJ binds instead. Because it reads the catalog
 * itself it can fill in each pick's canonical id, which makes resolution exact
 * rather than a match.
 *
 * What it is NOT is clever. There is no similarity graph, no palette, no sense of
 * flow beyond keeping one artist off its own heels. Everything it does is a rule
 * an operator could state out loud, which is the right amount of judgement for
 * something with no ears.
 */
@Injectable()
export class CatalogSetGenerator extends SetGenerator {
    constructor(
        private readonly candidates: CandidatesRepository,
        private readonly history: PlayHistoryRepository,
    ) {
        super();
    }

    async generate(inputs: SetInputs): Promise<TrackPick[]> {
        const { count, rules } = inputs;
        if (count <= 0) return [];

        // Both windows are read at generation time rather than passed in, because
        // they move: a refill that ran a minute ago has itself changed the answer.
        // A disabled rule costs no query at all — see the repository.
        const [songKeys, artistKeys] = await Promise.all([
            this.history.songKeysSince(rules.repeatWindowDays),
            this.history.artistKeysSince(rules.artistCooldownMinutes),
        ]);

        const recent = {
            songKeys: union(songKeys, inputs.avoidSongKeys),
            artistKeys: union(artistKeys, inputs.avoidArtistKeys),
        };

        const sampled = await this.candidates.sample(count);
        const scored = sampled.map(toRotationCandidate);

        // The same rules `PickResolver` applies to every pick from every generator, applied
        // again here and deliberately. Not redundancy: filtering BEFORE the draw is what keeps
        // the draw from spending its weight on candidates that cannot air, and filtering at the
        // resolver is what makes the rules true for a generator that never read this repository.
        // Neither one is safe to delete on the grounds that the other exists.
        const eligible = applyRules(scored, rules, recent);

        return spaceArtists(drawWeighted(eligible, count)).map(candidate => ({
            title: candidate.track.title,
            artist: candidate.track.artist,
            trackId: candidate.track.trackId,
        }));
    }
}

/** A candidate carrying the row it came from, so the draw can hand back the whole thing. */
interface ScoredCandidate extends RotationCandidate {
    track: CandidateTrack;
}

const toRotationCandidate = (track: CandidateTrack): ScoredCandidate => ({
    songKey: songKey(track.title, [track.artist]),
    artistKey: artistKey([track.artist]),
    rating: track.rating,
    track,
});

const union = (base: ReadonlySet<string>, extra?: ReadonlySet<string>): ReadonlySet<string> => {
    if (!extra || extra.size === 0) return base;
    return new Set([...base, ...extra]);
};

/**
 * Draw `count` without replacement, favouring what the operator has liked.
 *
 * Weighted rather than sorted, because sorting by rating would play the same
 * liked handful every time and call it programming. A liked track is drawn twice
 * as often; everything else still gets its turn.
 */
const drawWeighted = (candidates: readonly ScoredCandidate[], count: number): ScoredCandidate[] => {
    const pool = [...candidates];
    const drawn: ScoredCandidate[] = [];

    while (pool.length > 0 && drawn.length < count) {
        const total = pool.reduce((sum, candidate) => sum + weightOf(candidate), 0);
        let ticket = Math.random() * total;

        let index = pool.length - 1;
        for (let position = 0; position < pool.length; position++) {
            ticket -= weightOf(pool[position]!);
            if (ticket <= 0) {
                index = position;
                break;
            }
        }
        drawn.push(pool.splice(index, 1)[0]!);
    }
    return drawn;
};
