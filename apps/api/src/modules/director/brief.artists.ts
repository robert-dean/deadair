import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { Logger } from '@maroonedsoftware/logger';
import { ArtistsRepository } from '#modules/catalog/artists.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { errorText } from '#modules/shared/error.text.js';
import { PlayHistoryRepository } from './play.history.repository.js';

/**
 * The artists a brief names, the ones off air longest first.
 *
 * ## The failure this exists for
 *
 * A brief that names its acts is a list, and a model works down a list in the order it was written.
 * Measured on the live station, 2026-10-11: The Boneyard's brief names twenty-four acts, and three
 * refills searched the first five, the first five again, and the first seventeen before running out
 * of time. Kreator, Sodom, Cannibal Corpse, Behemoth, Mastodon and Queensrÿche were never searched
 * at all, and six acts took 39 of the show's 86 plays. Every one of the twenty-four was in the
 * library. Nothing was wrong with the brief; the station only ever read the top of it.
 *
 * So the names are read out of the brief and ordered by the history instead, and whatever programmes
 * the hour starts from the act it has neglected longest.
 *
 * ## Library artists, found in the brief, rather than the brief parsed
 *
 * A brief is prose ("Thrash and groove: Metallica, Megadeth, Slayer"), and splitting it on commas
 * and colons is a parser for one operator's punctuation. Asking which artists the LIBRARY holds whose
 * names appear in it is a closed question with no grammar in it, and an act the library has never
 * held is one nothing downstream could look up by name anyway. See {@link ArtistsRepository.namedIn}
 * for what that match does and does not tell apart.
 *
 * ## Leads, never rules
 *
 * Nothing here decides what airs. Every caller hands on names, and `PickResolver` still judges each
 * record against the dislikes, the repeat window and the cooldown. A read that fails answers with
 * nothing, which leaves every caller doing what it did before this existed.
 */

/** One act a brief names, with when it last aired here. */
export interface BriefArtist {
    /** As the library spells it, which is what a provider lookup wants. */
    name: string;
    artistKey: string;
    /** Absent when the history holds no airing, inside its retention. */
    lastAiredAt?: DateTime;
}

@Injectable()
export class BriefArtists {
    constructor(
        private readonly artists: ArtistsRepository,
        private readonly history: PlayHistoryRepository,
        private readonly identity: StationIdentity,
        private readonly logger: Logger,
    ) {}

    /**
     * The acts `brief` names, longest off air first. An act with no airing comes before every act
     * with one; ties keep the order the brief named them in, so the operator's own order still says
     * something.
     */
    async named(brief: string | undefined): Promise<BriefArtist[]> {
        const text = (brief ?? '').trim();
        if (text.length === 0) return [];

        try {
            const found = await this.artists.namedIn(text);
            if (found.length === 0) return [];

            const unique = [...new Map(found.map(artist => [artist.artistKey, artist])).values()];
            const lastAired = await this.history.lastAiredByArtist(
                unique.map(artist => artist.artistKey),
                this.identity.stationKey,
            );

            return orderByNeglect(
                unique.map(artist => {
                    const at = lastAired.get(artist.artistKey);
                    return { name: artist.name, artistKey: artist.artistKey, ...(at === undefined ? {} : { lastAiredAt: at }) };
                }),
                text,
            );
        } catch (error) {
            this.logger.warn(`director: could not read which artists the brief names; programming without them (${errorText(error)})`);
            return [];
        }
    }
}

/**
 * Never aired first, then oldest airing first, ties in the order the brief names them.
 *
 * Exported for the tests, since it is the whole of the decision and needs no database to check.
 */
export function orderByNeglect(artists: readonly BriefArtist[], brief: string): BriefArtist[] {
    const position = (artist: BriefArtist): number => {
        const at = brief.indexOf(artist.name);
        return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    const aired = (artist: BriefArtist): number => artist.lastAiredAt?.toMillis() ?? Number.NEGATIVE_INFINITY;

    return [...artists].sort((left, right) => aired(left) - aired(right) || position(left) - position(right));
}
