import { Injectable } from 'injectkit';
import { DataRepository } from '#modules/data/data.repository.js';

/** An artist the library can play a record by. */
export interface OwnedArtist {
    /** `normalizeKey` of the name, which is how `SimilarityService` and the rotation keys compare artists. */
    artistKey: string;
    name: string;
}

/** Two artists credited together on a record the library holds: the one factual link the catalog keeps. */
export interface CoCredit extends OwnedArtist {
    /** The record they share, as it is titled, and its lead artist, for a presenter to name. */
    title: string;
    lead: string;
}

/**
 * The catalog questions a route between two artists asks (`route.planner.ts`).
 *
 * Kept apart from `CandidatesRepository` because neither answers "what could I play": they say which
 * artists are on the map at all, and how two of them are connected by a fact rather than an opinion.
 */
@Injectable()
export class RouteRepository extends DataRepository {
    /**
     * Which of these artists the library can play a record BY: lead on a live, unmerged record with a
     * copy that is not missing. A route only goes through an artist it can air.
     *
     * Lead only, because the record chosen for a stop is one of theirs; a guest spot is a connection
     * (see {@link coCredits}) and not a record by them.
     */
    async ownedArtists(artistKeys: readonly string[]): Promise<Map<string, OwnedArtist>> {
        const keys = [...new Set(artistKeys)].filter(key => key.length > 0);
        if (keys.length === 0) return new Map();

        const rows = await this.db
            .selectFrom('deadair.artists')
            .select(['deadair.artists.artistKey', 'deadair.artists.name'])
            .where('deadair.artists.artistKey', 'in', keys)
            .where('deadair.artists.mergedIntoId', 'is', null)
            .where('deadair.artists.rating', '<>', -1)
            .where(eb =>
                eb.exists(
                    eb
                        .selectFrom('deadair.tracks')
                        .innerJoin('deadair.trackSources', 'deadair.trackSources.trackId', 'deadair.tracks.id')
                        .select('deadair.tracks.id')
                        .whereRef('deadair.tracks.artistId', '=', 'deadair.artists.id')
                        .where('deadair.tracks.mergedIntoId', 'is', null)
                        .where('deadair.tracks.rating', '<>', -1)
                        .where('deadair.trackSources.missingAt', 'is', null),
                ),
            )
            .execute();

        return new Map(rows.map(row => [row.artistKey, { artistKey: row.artistKey, name: row.name }]));
    }

    /**
     * Every artist credited on a live record together with this one, and one record they share.
     *
     * From `deadair.track_artists`, which holds every credit on every record the library holds, so a
     * guest verse is a link both ways. One row per partner, the first record found, at most `limit`.
     */
    async coCredits(artistKey: string, limit = 20): Promise<CoCredit[]> {
        if (artistKey.length === 0) return [];

        const rows = await this.db
            .selectFrom('deadair.trackArtists as mine')
            .innerJoin('deadair.artists as me', 'me.id', 'mine.artistId')
            .innerJoin('deadair.trackArtists as theirs', join =>
                join.onRef('theirs.trackId', '=', 'mine.trackId').onRef('theirs.artistId', '<>', 'mine.artistId'),
            )
            .innerJoin('deadair.artists as partner', 'partner.id', 'theirs.artistId')
            .innerJoin('deadair.tracks as track', 'track.id', 'mine.trackId')
            .innerJoin('deadair.artists as lead', 'lead.id', 'track.artistId')
            .distinctOn('partner.artistKey')
            .select(['partner.artistKey', 'partner.name', 'track.title', 'lead.name as lead'])
            .where('me.artistKey', '=', artistKey)
            .where('partner.mergedIntoId', 'is', null)
            .where('track.mergedIntoId', 'is', null)
            .orderBy('partner.artistKey')
            .orderBy('track.title')
            .limit(limit)
            .execute();

        return rows.map(row => ({ artistKey: row.artistKey, name: row.name, title: row.title, lead: row.lead }));
    }
}
