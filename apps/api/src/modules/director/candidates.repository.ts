import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { DataRepository } from '#modules/data/data.repository.js';
import { normalizeKey } from '#modules/catalog/catalog.keys.js';
import { ADVISORY_DEFAULT, advisoryRank, demandsClean, type AdvisoryPolicy } from './advisory.policy.js';

/**
 * The catalog, read the way the director needs it: tracks that can actually be
 * played, and the copy to play them from.
 *
 * Its own repository rather than a method on the catalog's, following
 * `EnrichmentModule`, which likewise reaches the catalog tables through its own.
 * The queries here answer the director's questions — "what could I play" and
 * "which binding serves this work" — and neither belongs on a read surface built
 * for browsing a library.
 */

/** One track the station could play, with everything selection needs to judge it. */
export interface CandidateTrack {
    trackId: string;
    title: string;
    /** The canonical lead artist's name. Identity is taken from this, not from the credit line. */
    artist: string;
    /** The credit as written on the release, for display. */
    credit: string;
    /** How the station feels about this work once its record and its artist are taken into account: -1, 0 or 1. See {@link effectiveRating}. */
    rating: number;
}

/** A playable copy of a work, in one provider's id space. */
export interface TrackBinding {
    trackId: string;
    pluginId: string;
    externalId: string;
    durationMs?: number;
}

/**
 * How many candidates one sample pulls before the rules thin it out.
 *
 * Generous, because the rules can reject most of a sample: everything inside a
 * three-day repeat window, everything by an artist heard in the last forty
 * minutes, and everything over the per-artist cap. A sample sized to the request
 * comes back short, the lineup runs dry, and the station asks again immediately.
 */
const SAMPLE_MULTIPLIER = 12;
const SAMPLE_CEILING = 500;

/**
 * How the station feels about one work, as one number: `-1`, `0` or `1`.
 *
 * An opinion is held at three levels and inherits DOWNWARD in both directions, which is why this is
 * not a plain `least()` over the three columns:
 *
 * - **A dislike anywhere wins, absolutely.** Disliking an artist stops the station playing them,
 *   whatever any one of their songs says. That is an instruction rather than a preference, and it
 *   is why the veto is taken first.
 * - **Otherwise the strongest like wins.** Liking an artist means play more of them, and liking one
 *   song means play that song more; neither should need the other two levels to agree before it
 *   counts for anything.
 *
 * The `least()` this replaces got the first half right and silently swallowed the second: a liked
 * song on an unrated record by an unrated artist came out as `0`, so {@link weightOf} never doubled
 * anything unless all three levels had been rated the same way. Liking a record did nothing at all,
 * which made the whole positive half of the console's rating control decorative.
 *
 * An album is `coalesce(…, 0)` because `tracks.album_id` is nullable: a single ingested outside any
 * release has no record to have an opinion about, and that is "no opinion" rather than a missing
 * one.
 */
const RATING_COLUMNS = [sql.ref('deadair.tracks.rating'), sql`coalesce(${sql.ref('deadair.albums.rating')}, 0)`, sql.ref('deadair.artists.rating')];

const effectiveRating = () => sql<number>`case
    when least(${sql.join(RATING_COLUMNS)}) = -1 then -1
    else greatest(${sql.join(RATING_COLUMNS)})
end`;

@Injectable()
export class CandidatesRepository extends DataRepository {
    /**
     * A random sample of tracks the station could play right now.
     *
     * Three things narrow it, and each one is load-bearing:
     *
     * - **A live binding must exist.** A canonical track with no provider that
     *   still serves it is a work the catalog remembers and the station cannot
     *   play; choosing it produces an item that fails to resolve and a gap.
     * - **Nothing merged away.** A merged row is the same work described twice,
     *   and the loser's metadata is the stale half.
     * - **Nothing disliked**, at track, record or artist level. This is the same
     *   filter `rejectDisliked` applies in memory, and it is deliberately in both
     *   places: this one keeps a disliked track out of the sample at all, and that
     *   one catches anything arriving by another route.
     *
     * Under `clean-only` the live-binding test gains one more condition, so a work
     * whose only playable copies are explicit or unmarked is not drawn at all. The
     * two `prefer-` states narrow NOTHING here, which is the same call the repeat
     * window makes: they are satisfied by choosing the right copy in
     * {@link bindingsFor}, and dropping a work from the draw because its preferred
     * version is missing would shrink the pool for a preference that was going to
     * be met by the other copy anyway.
     *
     * `order by random()` reads the whole candidate set, which is honest at the
     * scale this runs at — a station's library is thousands of rows, and this runs
     * once per refill in a background job, not per request.
     */
    async sample(count: number, policy: AdvisoryPolicy = ADVISORY_DEFAULT): Promise<CandidateTrack[]> {
        const limit = Math.min(SAMPLE_CEILING, Math.max(1, count) * SAMPLE_MULTIPLIER);

        const rows = await this.db
            .selectFrom('deadair.tracks')
            .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.tracks.artistId')
            .leftJoin('deadair.albums', 'deadair.albums.id', 'deadair.tracks.albumId')
            .select(['deadair.tracks.id as trackId', 'deadair.tracks.title', 'deadair.artists.name as artist', 'deadair.tracks.artists as credit'])
            // One number for "how does the station feel about this", across all three levels.
            .select(effectiveRating().as('rating'))
            .where('deadair.tracks.mergedIntoId', 'is', null)
            .where(eb =>
                eb.exists(
                    eb
                        .selectFrom('deadair.trackSources')
                        .select('deadair.trackSources.id')
                        .whereRef('deadair.trackSources.trackId', '=', 'deadair.tracks.id')
                        .where('deadair.trackSources.missingAt', 'is', null)
                        // A POSITIVE 'clean'. Null is "the provider did not say", never consent.
                        .$if(demandsClean(policy), qb => qb.where('deadair.trackSources.advisory', '=', 'clean')),
                ),
            )
            .where('deadair.tracks.rating', '<>', -1)
            .where('deadair.artists.rating', '<>', -1)
            .where(eb => eb.or([eb('deadair.albums.rating', 'is', null), eb('deadair.albums.rating', '<>', -1)]))
            .orderBy(sql`random()`)
            .limit(limit)
            .execute();

        return rows.map(row => ({
            trackId: row.trackId,
            title: row.title,
            artist: row.artist,
            credit: row.credit,
            rating: Number(row.rating),
        }));
    }

    /**
     * How the station feels about a batch of works it did not draw itself.
     *
     * The same {@link effectiveRating} {@link sample} computes, asked of ids rather than
     * produced alongside a random draw. It exists because a pick can arrive from a generator that
     * never touched this repository — a model naming a record — and `rejectDisliked` has to be able
     * to judge it anyway. A dislike is an instruction rather than a preference, so the one thing
     * that must never depend on WHICH generator chose a track is whether the operator forbade it.
     *
     * A track with no row answers with nothing rather than `0`. "The catalog has no opinion" and
     * "the catalog has never heard of it" are different facts, and only the caller knows which of
     * them is a reason to drop the pick.
     */
    async ratingsFor(trackIds: readonly string[]): Promise<Map<string, number>> {
        const ratings = new Map<string, number>();
        if (trackIds.length === 0) return ratings;

        const rows = await this.db
            .selectFrom('deadair.tracks')
            .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.tracks.artistId')
            .leftJoin('deadair.albums', 'deadair.albums.id', 'deadair.tracks.albumId')
            .select('deadair.tracks.id as trackId')
            .select(effectiveRating().as('rating'))
            .where('deadair.tracks.id', 'in', [...trackIds])
            .execute();

        for (const row of rows) ratings.set(row.trackId, Number(row.rating));
        return ratings;
    }

    /**
     * The playable copies of a batch of works, best first.
     *
     * "Best" is: a binding the provider still offers, then the station's advisory
     * policy, then the operator's own order of preference. A row carrying
     * `missing_at` is excluded outright rather than ranked last — the provider has
     * said it no longer has it, and handing that to the player is a gap. Under
     * `clean-only` a row that is not positively `clean` is excluded the same way,
     * and a work left with no rows at all simply gets no binding, which the caller
     * already treats as "nothing can play this".
     *
     * ## The advisory outranks the provider preference, and that order matters
     *
     * This is the decision here that is easiest to get backwards and has no symptom
     * when it is. The policy is a rule about CONTENT and the provider list is a
     * preference about DELIVERY — which machine the bytes come from — so content
     * wins and delivery breaks the tie. Ranked the other way, a station set to
     * `prefer-clean` whose clean copy sits on the second-choice provider is handed
     * the explicit one from the first, and nothing anywhere says why a station that
     * was told to keep it clean is not.
     *
     * @param preference - Plugin ids in the operator's order. Anything unlisted
     *   sorts after everything listed, so an unconfigured station still gets a
     *   deterministic answer rather than a random one.
     * @param policy - The station's advisory policy. Defaults to `prefer-explicit`,
     *   which is the closest this type has to "no opinion" — that is what a caller
     *   asking whether a record is still AVAILABLE rather than which copy to
     *   programme should pass. See `DirectorService.toPlayerItems`.
     */
    async bindingsFor(
        trackIds: readonly string[],
        preference: readonly string[] = [],
        policy: AdvisoryPolicy = ADVISORY_DEFAULT,
    ): Promise<Map<string, TrackBinding>> {
        const best = new Map<string, TrackBinding>();
        if (trackIds.length === 0) return best;

        const rows = await this.db
            .selectFrom('deadair.trackSources')
            .select(['trackId', 'pluginId', 'externalId', 'durationMs', 'lastSeenAt', 'advisory'])
            .where('trackId', 'in', [...trackIds])
            .where('missingAt', 'is', null)
            // A POSITIVE 'clean'. Null is "the provider did not say", never consent.
            .$if(demandsClean(policy), qb => qb.where('advisory', '=', 'clean'))
            .execute();

        const rank = (pluginId: string): number => {
            const index = preference.indexOf(pluginId);
            return index < 0 ? preference.length : index;
        };
        // Advisory first, provider second. See the note above; the tuple is compared in this
        // order and reversing the two is the whole of that mistake.
        const better = (candidate: (typeof rows)[number], incumbent: (typeof rows)[number]): boolean => {
            const byAdvisory = advisoryRank(policy, candidate.advisory) - advisoryRank(policy, incumbent.advisory);
            if (byAdvisory !== 0) return byAdvisory < 0;
            return rank(candidate.pluginId) < rank(incumbent.pluginId);
        };

        // Ranked in memory rather than in SQL: the order depends on an array the operator
        // supplies, and a CASE built from it would have to be assembled per call anyway for a
        // list this short.
        const chosen = new Map<string, (typeof rows)[number]>();
        for (const row of rows) {
            const current = chosen.get(row.trackId);
            if (current && !better(row, current)) continue;
            chosen.set(row.trackId, row);
        }

        for (const row of chosen.values()) {
            best.set(row.trackId, {
                trackId: row.trackId,
                pluginId: row.pluginId,
                externalId: row.externalId,
                ...(row.durationMs == null ? {} : { durationMs: row.durationMs }),
            });
        }
        return best;
    }

    /**
     * The canonical track behind a title and an artist NAME, for a pick that
     * arrived without an id.
     *
     * The fuzzy rung of the catalog's own resolution ladder, reused: both sides
     * are normalized with `normalizeKey`, so "Beyoncé" matches "Beyonce". Nothing
     * looser than that — this decides what the station airs, and a near-miss here
     * plays the wrong record rather than failing visibly.
     *
     * Returns nothing for a title that normalizes to empty, which would otherwise
     * match every untitled track by the artist.
     *
     * Answers with the CANONICAL title and lead artist alongside the id, rather than only the
     * id. The caller keys the pick for the rotation rules, and keying it off the strings that
     * were searched WITH instead of the row that was found makes those keys disagree with the
     * ones `play_history` is written from — the pick says "Yeah!" by "Usher" and the row says
     * "Yeah! (feat. Lil Jon & Ludacris)". Both sides of a repeat window have to come off the
     * same row for the window to mean anything.
     */
    async findByName(title: string, artist: string): Promise<{ trackId: string; title: string; artist: string } | undefined> {
        const titleKey = normalizeKey(title);
        const artistKey = normalizeKey(artist);
        if (!titleKey || !artistKey) return undefined;

        const row = await this.db
            .selectFrom('deadair.tracks')
            .innerJoin('deadair.artists', 'deadair.artists.id', 'deadair.tracks.artistId')
            .select(['deadair.tracks.id as trackId', 'deadair.tracks.title', 'deadair.artists.name as artist'])
            .where('deadair.tracks.titleKey', '=', titleKey)
            .where('deadair.artists.artistKey', '=', artistKey)
            .where('deadair.tracks.mergedIntoId', 'is', null)
            // Oldest wins when a title has several rows (an album cut and a single edit),
            // so the choice is at least stable between runs.
            .orderBy('deadair.tracks.createdAt', 'asc')
            .executeTakeFirst();

        return row;
    }
}
