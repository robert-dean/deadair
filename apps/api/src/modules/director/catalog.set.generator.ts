import { LyricLabelsRepository } from '#modules/lyrics/lyric.labels.repository.js';
import type { LyricMood } from '#modules/lyrics/lyric.moods.js';
import { moodFits } from './mood.lean.js';
import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { DateTime } from 'luxon';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { advisoryPolicy, demandsClean, type AdvisoryPolicy } from './advisory.policy.js';
import { AdvisoryWatch } from './advisory.watch.js';
import { EraWatch } from './era.watch.js';
import { CandidatesRepository, bindsAnything, sampleSize, type CandidateTrack, type EraWindow } from './candidates.repository.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { albumKey, artistKey, songKey } from './rotation.keys.js';
import { applyRulesHoldingQueue, spaceArtists, weightOf, type RotationCandidate } from './rotation.rules.js';
import { SetGenerator, type SetInputs, type TrackPick } from './set.generator.js';
import { freshnessOf, historyDaysFor, resolveSmartShuffle } from './smart.shuffle.js';
import { trackLengthBounds } from './track.length.js';
import { BlockRulesRepository } from './block.rules.repository.js';
import { STEER_LEAN, steered } from './genre.steer.js';
import type { CompiledRule } from './block.rules.js';
import { NeverPlay } from './never.play.js';
import type { TrackLengthBounds } from './track.length.js';

/**
 * How many draws one sample may take round what a never-play rule refused, at most.
 *
 * Each draw leaves out everything the ones before it returned, and is sized from how much of what
 * they drew was refused, so a second draw is usually enough. Bounded because the alternative is
 * reading the whole library on every refill for a station whose rules leave it almost nothing, and
 * four draws of up to {@link sampleSize} each is already more than many libraries hold. What is
 * still short after that is reported the way any short draw is: by the refill coming back short.
 */
const NEVER_PLAY_DRAWS = 4;

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
        // The genre steer, read per refill so one an operator just set leans the next batch.
        private readonly rules: BlockRulesRepository,
        private readonly history: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly config: AppConfig,
        private readonly watch: AdvisoryWatch,
        private readonly eraWatch: EraWatch,
        /** What mood each record was judged to be in, for a broadcast that leans into one. */
        private readonly labels: LyricLabelsRepository,
        /** The never-play rules, applied to the draw itself so a refused record never takes a place in it. */
        private readonly neverPlay: NeverPlay,
    ) {
        super();
    }

    /** The sampled records a model judged to be in this mood. Empty when nothing could be read. */
    private async fittingMood(trackIds: readonly string[], mood: LyricMood): Promise<Set<string>> {
        try {
            const moods = await this.labels.moodsForTracks(trackIds);
            return new Set(trackIds.filter(id => moodFits(moods.get(id), mood)));
        } catch {
            return new Set();
        }
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
        const bounds = trackLengthBounds(this.config);
        const [steer, refusing] = await Promise.all([this.rules.steer(), this.refusing(inputs)]);
        const [ordinary, leaning] = await Promise.all([
            this.drawPlayable(count, policy, refusing, era, bounds),
            // A second, smaller draw from the steered genres, so a lean toward something the library
            // holds little of still has records to lean on. Loose here and precise below.
            steer === undefined ? Promise.resolve([]) : this.drawPlayable(count, policy, refusing, era, bounds, steer.genres),
        ]);
        await this.watchStarvation(policy, era, count, ordinary.length, refusing);
        const sampled = mergeByTrack(ordinary, leaning);
        const leans = steer === undefined ? undefined : await this.leaningToward(sampled, steer.genres);
        // Freshness is stamped on what was SAMPLED, so it can only choose between the records the
        // sample drew. That is enough: the sample is random, so over a few refills every record is
        // offered, and the weight decides which of the offered ones win. If it ever has to be true of
        // the whole library in one batch, the fix is ordering the SQL by a randomised function of
        // the age rather than raising the ceiling (the same note #30 makes about a play count).
        const now = DateTime.utc();
        // The broadcast's mood, the period's sibling: a number the model already stored, so the floor
        // can lean on it with nothing reading prose. Read only when a mood is named, for the sampled
        // records only, and a failed read costs the lean and never the batch.
        const fitting =
            inputs.mood === undefined
                ? new Set<string>()
                : await this.fittingMood(
                      sampled.map(track => track.trackId),
                      inputs.mood,
                  );
        const scored = sampled.map(track => {
            const candidate = toRotationCandidate(
                track,
                smartShuffle.enabled ? { lastAired, now, horizonDays: smartShuffle.horizonDays } : undefined,
            );
            // The mood and the genre steer are two leans and both can hold: each multiplies in.
            return {
                ...candidate,
                ...(fitting.has(track.trackId) ? { moodFit: true as const } : {}),
                ...(leans?.has(track.trackId) ? { lean: STEER_LEAN } : {}),
            };
        });

        // The same rules `PickResolver` applies to every pick from every generator, applied
        // again here and deliberately. Not redundancy: filtering BEFORE the draw is what keeps
        // the draw from spending its weight on candidates that cannot air, and filtering at the
        // resolver is what makes the rules true for a generator that never read this repository.
        // Neither one is safe to delete on the grounds that the other exists.
        //
        // Artists queued inside the cooldown are held here too, and let back in rather than leaving
        // the draw short: this is the floor, and on a small library holding them could empty it.
        const eligible = applyRulesHoldingQueue(scored, rules, recent, inputs.queuedArtistKeys, count);

        return spaceArtists(drawWeighted(eligible, count)).map(candidate => ({
            title: candidate.track.title,
            artist: candidate.track.artist,
            trackId: candidate.track.trackId,
        }));
    }

    /**
     * The never-play rules holding now for this broadcast, or none when they cannot be read.
     *
     * An unreadable rule table costs the early filter and never the batch: this is the floor, and
     * `PickResolver` judges every pick against the same rules again, which is the guarantee.
     */
    private async refusing(inputs: SetInputs): Promise<CompiledRule[]> {
        try {
            return await this.neverPlay.holding(inputs.broadcast);
        } catch {
            return [];
        }
    }

    /**
     * A sample with whatever a never-play rule refuses already taken out, drawn again round the
     * refusals until it is the size an ordinary sample would be.
     *
     * Rules are exclude-only and absolute, and they used to be applied only at `PickResolver`, AFTER
     * this generator had drawn, weighed and chosen. A station refusing most of its library then drew
     * a sample that was mostly refused records, chose among them, and handed back a batch the
     * resolver emptied: the refill starved, and the lineup ran dry with records it may play still
     * sitting in the library.
     *
     * **The precise test stays in TypeScript.** A genre rule matches on word boundaries after the
     * catalog's own fold (`genre.match.ts`), and a SQL imitation of that is a second matcher that can
     * disagree with the first, which in the exclude direction is a silent over-block. So SQL is given
     * only exact equality (`SampleExclusions.refusedTags`), which is provably a subset and
     * spares the draw the commonest case; each drawn batch is then judged by `NeverPlay`, the same
     * code the resolver runs; and what that refuses is made up by drawing again, leaving out every
     * record already drawn. The resolver's check is not made redundant by this and must not be
     * deleted for it: picks reach it from generators that never read this repository.
     */
    private async drawPlayable(
        count: number,
        policy: AdvisoryPolicy,
        refusing: readonly CompiledRule[],
        era?: EraWindow,
        bounds?: TrackLengthBounds,
        taggedLike?: readonly string[],
    ): Promise<CandidateTrack[]> {
        if (refusing.length === 0) return await this.candidates.sample(count, policy, era, bounds, taggedLike);

        const wanted = sampleSize(count);
        const refusedTags = refusing.map(rule => rule.target);
        const kept: CandidateTrack[] = [];
        const drawnIds: string[] = [];
        // The first draw is the ordinary size. Each one after it is sized from how much of the
        // library the rules have refused so far, so a station refusing nine records in ten asks for
        // ten times what it is short rather than walking the library a sample at a time.
        let asking = count;

        for (let draw = 0; draw < NEVER_PLAY_DRAWS && kept.length < wanted; draw++) {
            const drawn = await this.candidates.sample(asking, policy, era, bounds, taggedLike, { refusedTags, trackIds: [...drawnIds] });
            const ids = drawn.map(track => track.trackId);
            drawnIds.push(...ids);

            const blocked = await this.neverPlay.blockedUnder(refusing, ids);
            kept.push(...drawn.filter(track => !blocked.has(track.trackId)));
            // A short draw is the library running out: asking again would find nothing new.
            if (drawn.length < sampleSize(asking)) break;

            // A draw that kept nothing is counted as keeping one, so the next is large rather than infinite.
            const surviving = Math.max(1, kept.length) / drawnIds.length;
            // `sample` takes picks rather than rows, and turns one pick into `sampleSize(1)` rows.
            asking = Math.ceil((wanted - kept.length) / surviving / sampleSize(1));
        }
        return kept.slice(0, wanted);
    }

    /** Which drawn records really are in a steered genre, by the same matching a genre rule uses. */
    private async leaningToward(sampled: readonly CandidateTrack[], genres: readonly string[]): Promise<Set<string>> {
        const tags = await this.candidates.tagsFor(sampled.map(track => track.trackId));
        return new Set(sampled.flatMap(track => (steered(tags.get(track.trackId) ?? [], genres) ? [track.trackId] : [])));
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
    private async watchStarvation(
        policy: AdvisoryPolicy,
        era: EraWindow | undefined,
        count: number,
        drawn: number,
        refusing: readonly CompiledRule[],
    ): Promise<void> {
        if (drawn > 0) {
            this.watch.clear();
            this.eraWatch.clear();
            return;
        }

        // The PERIOD is asked about first, because it is the one an operator chose for this
        // broadcast and can undo in one edit — where the advisory is a standing station policy. A
        // draw emptied by both would otherwise be reported as the harder of the two to fix.
        if (bindsAnything(era)) {
            // Still round the never-play rules, so a draw they emptied is not blamed on the period.
            const withoutEra = await this.drawPlayable(count, policy, refusing);
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
        const withoutPolicy = await this.drawPlayable(count, 'prefer-explicit', refusing);
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

/** Two draws as one, each record once, the ordinary draw's copy first. */
function mergeByTrack(first: readonly CandidateTrack[], second: readonly CandidateTrack[]): CandidateTrack[] {
    const seen = new Set(first.map(track => track.trackId));
    return [...first, ...second.filter(track => !seen.has(track.trackId))];
}
