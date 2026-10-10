import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { TracksRepository } from '#modules/catalog/tracks.repository.js';
import type { TrackLyrics, TrackLyricsSource, TrackLyricsSources } from '#modules/catalog/types/catalog.types.js';
import type { NowPlayingLyrics } from '#modules/nowplaying/types/nowplaying.types.js';
import { playedCues } from '#modules/playout/annotate.js';
import { Rundown } from '#modules/playout/rundown.js';
import { isRenderItem } from '#modules/render/segment.source.js';
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
        private readonly rundown: Rundown,
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

    /**
     * The words of the record on air, and the two instants a player needs to follow along.
     *
     * What is on air is what the PLAYER says, as `/nowplaying` reads it, not what was last handed
     * over. A spoken item carries no lyrics: a break has none, and a talk-over rides its record, which
     * is what is reported. The cues travel separately rather than being folded into the line timings,
     * so the timings stay on the one timeline every other lyrics answer uses. The cue-out is the one a
     * player needs: the decoder's `remainingMs` counts down to it, so the position in the file is the
     * cue-out (or the file's length) minus what remains, with no wall clock involved.
     */
    async getNowPlayingLyrics(): Promise<NowPlayingLyrics> {
        const nowPlaying = this.rundown.nowPlaying();
        if (!nowPlaying) return { onAir: false };

        const { item, startedAt } = nowPlaying;
        const trackId = isRenderItem(item) ? undefined : item.trackId;
        if (trackId === undefined) return { onAir: true, startedAt };

        // Only the cues the player was handed: a cue-out it never received would put every client's
        // highlight ahead by however much tail the measurement trimmed.
        const cues = playedCues(item);
        const cueInMs = cues !== undefined && cues.cueInMs > 0 ? Math.round(cues.cueInMs) : undefined;
        return {
            onAir: true,
            trackId,
            startedAt,
            ...(cueInMs === undefined ? {} : { cueInMs }),
            ...(cues === undefined ? {} : { cueOutMs: Math.round(cues.cueOutMs) }),
            lyrics: pickLyrics(trackId, await this.ranked(trackId)),
        };
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
