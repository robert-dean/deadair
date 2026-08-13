import { baseForm, normalize } from '@deadair/plugin-sdk';

import type { SubsonicChild } from './navidrome.types.js';

/**
 * Deciding whether a search result is actually the track that was asked about.
 *
 * Needed because Subsonic search is a substring match with no relevance score
 * worth the name: asking for "Portishead Roads" can put a live version, a
 * remaster and a compilation appearance above the album track, and taking rank
 * one on faith would attribute one recording's year and tags to another.
 *
 * Deliberately conservative. A wrong answer here is worse than no answer: the
 * host records a miss on a short clock and asks again in a week, whereas a
 * confident mismatch is stored for ninety days and read out on air.
 */

/** How well a candidate agrees with what was asked for. */
type Agreement = 'exact' | 'base' | 'none';

function agree(candidate: string | undefined, reference: string): Agreement {
    if (!candidate) return 'none';
    if (normalize(candidate) === normalize(reference)) return 'exact';
    if (baseForm(candidate) === baseForm(reference)) return 'base';
    return 'none';
}

/** What the caller knows about the track it is asking about. */
export interface MatchRef {
    artist: string;
    title: string;
    album?: string;
}

/**
 * The best song in `songs` for `ref`, or `undefined` when none of them is
 * convincing.
 *
 * The rule: artist and title must both agree, exactly or in base form. Nothing
 * else can rescue a candidate — an album match is a tie-breaker between
 * candidates that already agree, never evidence on its own, because a
 * compilation's title matching proves only that the song is on a record with
 * that name.
 */
export function selectSong(songs: SubsonicChild[] | undefined, ref: MatchRef): SubsonicChild | undefined {
    let best: { song: SubsonicChild; score: number } | undefined;

    for (const song of songs ?? []) {
        if (!song.id) continue;

        const title = agree(song.title, ref.title);
        const artist = agree(song.artist, ref.artist);
        if (title === 'none' || artist === 'none') continue;

        // Exact beats decorated, and a matching album breaks the tie between two
        // that are otherwise equal — which is what picks the album track over the
        // greatest-hits copy of it.
        const score = (title === 'exact' ? 4 : 0) + (artist === 'exact' ? 2 : 0) + (ref.album && agree(song.album, ref.album) !== 'none' ? 1 : 0);

        if (!best || score > best.score) best = { song, score };
    }

    return best?.song;
}
