import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import type { TrackLyrics, TrackLyricsSource, TrackLyricsSources } from '#modules/catalog/types/catalog.types.js';
import { lyricsProviderRank } from './lyrics.rank.js';
import { LyricsRepository, type ServedLyrics } from './lyrics.repository.js';

/**
 * The station's single answer for one record, from its sources already in the order it believes them.
 *
 * The first source with timed lines wins, then the first with plain words, and one source's fields are
 * never mixed with another's: a plain lyric from one site and the timings from another can be two
 * different transcriptions of the same song. With no words anywhere, a source saying nobody sings on
 * it makes the record instrumental.
 */
export function pickLyrics(trackId: string, ranked: readonly ServedLyrics[]): TrackLyrics {
    const chosen = ranked.find(row => row.synced !== undefined) ?? ranked.find(row => row.plain !== undefined);
    if (chosen) {
        return {
            trackId,
            kind: 'words',
            provider: chosen.provider,
            ...(chosen.plain === undefined ? {} : { plain: chosen.plain }),
            ...(chosen.synced === undefined ? {} : { synced: chosen.synced }),
            ...(chosen.language === undefined ? {} : { language: chosen.language }),
        };
    }

    const instrumental = ranked.find(row => row.instrumental);
    if (instrumental) return { trackId, kind: 'instrumental', provider: instrumental.provider };

    return { trackId, kind: 'none' };
}

/**
 * The read-only side of a record's lyrics, for a signed-in client to show.
 *
 * Serves the words and nothing else touches them on the way: no prompt, no fact and no break is built
 * from what this returns. Sources are believed in `lyrics.providerOrder`, the order the vocal markers
 * use, so the words a client shows and the timing the presenter talks up to come from the same place.
 */
@Injectable()
export class LyricsReadService {
    constructor(
        private readonly tracks: TracksRepository,
        private readonly lyrics: LyricsRepository,
        private readonly config: AppConfig,
    ) {}

    /** @throws 404 for a record the catalog does not hold. A record with no lyrics yet is `kind: none`, not a 404. */
    async getTrackLyrics(id: string): Promise<TrackLyrics> {
        await this.mustExist(id);
        return pickLyrics(id, await this.ranked(id));
    }

    /** @throws 404 for a record the catalog does not hold. */
    async listTrackLyricsSources(id: string): Promise<TrackLyricsSources> {
        await this.mustExist(id);
        const sources: TrackLyricsSource[] = await this.ranked(id);
        return { trackId: id, sources };
    }

    /** Every source's answer for the record, best first. */
    protected async ranked(id: string): Promise<ServedLyrics[]> {
        return (await this.lyrics.wordsForServing(id)).sort(lyricsProviderRank(this.config));
    }

    private async mustExist(id: string): Promise<void> {
        const row = await this.tracks.findTrack(id);
        if (row === undefined) throw httpError(404).withDetails({ message: `track "${id}" is not in the catalog` });
    }
}
