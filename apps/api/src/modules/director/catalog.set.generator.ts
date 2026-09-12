import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { DateTime } from 'luxon';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { advisoryPolicy, demandsClean, type AdvisoryPolicy } from './advisory.policy.js';
import { AdvisoryWatch } from './advisory.watch.js';
import { EraWatch } from './era.watch.js';
import { CandidatesRepository, bindsAnything, type CandidateTrack, type EraWindow } from './candidates.repository.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { albumKey, artistKey, songKey } from './rotation.keys.js';
import { applyRules, spaceArtists, weightOf, type RotationCandidate } from './rotation.rules.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';
import { freshnessOf, historyDaysFor, resolveSmartShuffle } from './smart.shuffle.js';
import { trackLengthBounds } from './track.length.js';

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
 * **{@link SetInputs.era} is the one thing it does honour**, and the distinction is exactly the one
 * the paragraph below draws. A brief is an instruction and reading one takes something that can
 * read; a period is two integers, so narrowing the draw on it approximates nothing and the floor
 * stays the thing that cannot fail. That is why a period is a column beside the brief rather than
 * words inside it: prose reaches a model and nothing else, so a station asked for a decade in words
 * plays any decade the moment no model is configured.
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
        private readonly eraWatch: EraWatch,
    ) {
        super();
    }

    async generate(inputs: SetInputs): Promise<TrackPick[]> {
        const { count, rules } = inputs;
        if (count <= 0) return [];

        // Read per refill like the policy below, so an operator switching it is obeyed on the next
        // batch. Deliberately not a field of `rules`: a setlist zeroes every rule, and a setlist is
        // never drawn from here anyway, so there is nothing for a per-lineup override to decide.
        const smartShuffle = resolveSmartShuffle(this.config);

        // Both windows are read at generation time rather than passed in, because
        // they move: a refill that ran a minute ago has itself changed the answer.
        // A disabled rule costs no query at all — see the repository. The smart shuffle's horizon
        // rides the same trip and the same rule: off, it asks for zero days and pays nothing.
        const [songKeys, artistKeys, lastAired] = await Promise.all([
            this.history.songKeysSince(rules.repeatWindowDays, this.identity.stationKey),
            this.history.artistKeysSince(rules.artistCooldownMinutes, this.identity.stationKey),
            this.history.lastAiredSince(historyDaysFor(smartShuffle), this.identity.stationKey),
        ]);

        const recent = {
            songKeys: union(songKeys, inputs.avoidSongKeys),
            artistKeys: union(artistKeys, inputs.avoidArtistKeys),
        };

        // Read per refill rather than held, like every other setting the director reads, so an
        // operator changing it is obeyed on the next batch rather than after a restart.
        const policy = advisoryPolicy(this.config);
        // The ONE thing this binding honours about what the operator asked for, and the reason is
        // that it is not an instruction: a year range is exact, so narrowing on it costs the floor
        // none of the guarantee that keeps it the floor. The brief beside it stays unread.
        const era = inputs.era;
        const sampled = await this.candidates.sample(count, policy, era, trackLengthBounds(this.config));
        await this.watchStarvation(policy, era, count, sampled.length);
        // Freshness is stamped on what was SAMPLED, so it can only choose between the records the
        // sample drew. That is enough: the sample is random, so over a few refills every record is
        // offered, and the weight decides which of the offered ones win. If it ever has to be true of
        // the whole library in one batch, the fix is ordering the SQL by a randomised function of
        // the age rather than raising the ceiling (the same note #30 makes about a play count).
        const now = DateTime.utc();
        const scored = sampled.map(track =>
            toRotationCandidate(track, smartShuffle.enabled ? { lastAired, now, horizonDays: smartShuffle.horizonDays } : undefined),
        );

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
    private async watchStarvation(policy: AdvisoryPolicy, era: EraWindow | undefined, count: number, drawn: number): Promise<void> {
        if (drawn > 0) {
            this.watch.clear();
            this.eraWatch.clear();
            return;
        }

        // The PERIOD is asked about first, because it is the one an operator chose for this
        // broadcast and can undo in one edit — where the advisory is a standing station policy. A
        // draw emptied by both would otherwise be reported as the harder of the two to fix.
        if (bindsAnything(era)) {
            const withoutEra = await this.candidates.sample(count, policy);
            if (withoutEra.length > 0) {
                this.eraWatch.starved(era, withoutEra.length);
                return;
            }
        }
        this.eraWatch.clear();

        if (!demandsClean(policy)) return;

        // Asked WITHOUT the period as well, so a station that is both clean-only and inside a
        // narrow decade is not told its advisory is the problem when the decade is: this arm is only
        // reached when the period alone was not enough to explain the empty draw.
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

/** What a draw with smart shuffle on knows about when each song last aired. */
interface Freshness {
    lastAired: ReadonlyMap<string, DateTime>;
    now: DateTime;
    horizonDays: number;
}

/**
 * @param freshness - Absent with smart shuffle off, which leaves the candidate with no freshness at
 *   all rather than a freshness of `1`. The two weigh the same; only one of them says nothing was read.
 */
const toRotationCandidate = (track: CandidateTrack, freshness?: Freshness): ScoredCandidate => {
    const key = songKey(track.title, [track.artist]);
    return {
        songKey: key,
        artistKey: artistKey([track.artist]),
        ...(track.album === undefined ? {} : { albumKey: albumKey([track.artist], track.album) }),
        rating: track.rating,
        ...(freshness === undefined ? {} : { freshness: freshnessOf(freshness.lastAired.get(key), freshness.now, freshness.horizonDays) }),
        track,
    };
};

const union = (base: ReadonlySet<string>, extra?: ReadonlySet<string>): ReadonlySet<string> => {
    if (!extra || extra.size === 0) return base;
    return new Set([...base, ...extra]);
};

/**
 * Draw `count` without replacement, favouring what the operator has liked and, with smart
 * shuffle on, what the station has not played lately.
 *
 * Weighted rather than sorted, because sorting by rating would play the same
 * liked handful every time and call it programming. A liked track is drawn twice
 * as often; everything else still gets its turn. See {@link weightOf} for how the
 * two lean compose.
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
