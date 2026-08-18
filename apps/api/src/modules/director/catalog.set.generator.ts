import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { advisoryPolicy, demandsClean, type AdvisoryPolicy } from './advisory.policy.js';
import { AdvisoryWatch } from './advisory.watch.js';
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
 *
 * **{@link SetInputs.brief} is ignored here, deliberately.** Reading an instruction takes something
 * that can read, and any attempt to approximate one — matching the words against a genre column,
 * say — would make the floor's answer depend on how well a guess landed. The floor's whole job is
 * to be the thing that cannot fail, so a briefed station whose model produced nothing gets an
 * ordinary hour rather than a bad impression of the hour it asked for.
 */
@Injectable()
export class CatalogSetGenerator extends SetGenerator {
    readonly name = 'catalog';

    // The only binding that declares this, and the docblock above is the whole reason: it does not
    // read the brief BY DESIGN, so a station that would rather be silent than off-brief is asking
    // for exactly this generator to sit out. The similarity binding does not read one either and is
    // deliberately NOT marked — its seeds are records that actually aired, so under a brief that is
    // being honoured it is drawing from the brief's own results rather than around them.
    override readonly ignoresBrief = true;

    constructor(
        private readonly candidates: CandidatesRepository,
        private readonly history: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly config: AppConfig,
        private readonly watch: AdvisoryWatch,
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
            this.history.songKeysSince(rules.repeatWindowDays, this.identity.stationKey),
            this.history.artistKeysSince(rules.artistCooldownMinutes, this.identity.stationKey),
        ]);

        const recent = {
            songKeys: union(songKeys, inputs.avoidSongKeys),
            artistKeys: union(artistKeys, inputs.avoidArtistKeys),
        };

        // Read per refill rather than held, like every other setting the director reads, so an
        // operator changing it is obeyed on the next batch rather than after a restart.
        const policy = advisoryPolicy(this.config);
        const sampled = await this.candidates.sample(count, policy);
        await this.watchStarvation(policy, count, sampled.length);
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

    /**
     * Tell an empty draw caused by the policy apart from an empty library, and say which.
     *
     * The second query runs ONLY when a clean-only draw came back with nothing, which is a state
     * the station cannot programme out of anyway — so it costs a round trip in the case where
     * round trips have stopped mattering, and nothing at all the rest of the time.
     *
     * The two are indistinguishable from the outside and want opposite fixes: one is a setting to
     * change, the other is a library to fill. Without this the operator gets a silent station and
     * a feed saying the chain came up short, which is true of both.
     */
    private async watchStarvation(policy: AdvisoryPolicy, count: number, drawn: number): Promise<void> {
        if (drawn > 0) {
            this.watch.clear();
            return;
        }
        if (!demandsClean(policy)) return;

        const withoutPolicy = await this.candidates.sample(count, 'prefer-explicit');
        // A library that is empty either way is not this rule's doing, and claiming it would send
        // the operator to change a setting that was never the problem.
        if (withoutPolicy.length === 0) return;

        this.watch.starved(withoutPolicy.length);
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
