/**
 * Whether a record is a live recording, read off the version markers its provider wrote.
 *
 * What a `version: live` never-play rule asks (`block.rules.ts`), and why it reads text rather than
 * tags: on the live station, 2026-10-14, no track or album in a library of 5485 was tagged `live`,
 * and the enrichment keeps no release type to read one from. The marker is the evidence there is.
 *
 * **The word is not the marker.** 23 titles and 39 album names held `live` as a word, and the
 * searches that catch "Walk This Way - Live" also catch "Live Wire", "Live And Let Die", "Show Me How
 * to Live", "War Broadcast Live", *Long Live The Kane* and *LONG.LIVE.A$AP*. A rule that refuses a
 * record outright cannot be that loose, so only the places a provider puts a version are read:
 *
 * - a dashed suffix that STARTS with the word: "War Pigs - Live", "Rocket Queen - Live In Las Vegas /
 *   1992", "Seven Bridges Road - Live; 1999 Remaster", but not "Silver - Silence Live Mix";
 * - a bracketed suffix that starts with it, or says it was recorded live: "(Live)", "(Live at the
 *   Forum)", "[Live]", "(Live and Acoustic)", but not "(Silence Live Mix)";
 * - "Unplugged" or "In Concert" in either of those places, or anywhere in an album's name;
 * - for an ALBUM only, a name that opens on "Live at", "Live in", "Live from" or "Live on", or closes
 *   on "Live" ("Eagles Live", but not "Long Live"), or calls itself "Live Recordings".
 *
 * What this misses is a live album that never says so ("Live Era '87-'93" opens on neither, though
 * its tracks are marked) and a live record filed under a studio album's name. A miss airs a live
 * record; a false hit refuses a studio one with nothing on air to say why, so the misses are the
 * side to err on.
 */

/** A version that STARTS a dashed or bracketed suffix: "Live", "Live at …", "Recorded live", "Unplugged", "In Concert". */
const VERSION_OPENING = /^(?:live\b|recorded live\b|(?:mtv )?unplugged\b|in concert\b)/i;

/** Where a dashed suffix starts: a dash with a space either side, " - Live", " – Live at …". */
const DASH = /\s[-–—]\s/;

/** Every bracketed segment: "(Live)", "[Live at the Forum]". */
const BRACKETED = /[([{]([^)\]}]*)[)\]}]/g;

/** An album that is a live album by its whole name rather than a suffix. */
const LIVE_ALBUM = [
    /^live (?:at|in|from|on)\b/i,
    // "Eagles Live", "… Museum Live" and "'Firefall Reunion Live'". "Long Live" is excluded.
    /(?<!\blong )\blive[!'"’]*$/i,
    /\blive recordings?\b/i,
    /\bunplugged\b/i,
    /\bin concert\b/i,
];

/** Whether a title or an album name carries a live version marker in a suffix. */
function markedLive(text: string): boolean {
    // Every segment after the first, so "Song - 2011 Remaster - Live" is read as well as "Song - Live".
    if (text.split(DASH).slice(1).some(segment => VERSION_OPENING.test(segment.trim()))) return true;
    for (const match of text.matchAll(BRACKETED)) if (VERSION_OPENING.test((match[1] ?? '').trim())) return true;
    return false;
}

/** Whether a record is a live recording, by its title's markers or its album's. */
export function isLiveRecording(title: string, album?: string): boolean {
    if (markedLive(title)) return true;
    if (album === undefined || album.trim() === '') return false;
    const name = album.trim();
    return markedLive(name) || LIVE_ALBUM.some(pattern => pattern.test(name));
}
