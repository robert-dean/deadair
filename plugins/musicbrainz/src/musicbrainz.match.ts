/**
 * Turning "the artist and title a provider gave us" into "one MusicBrainz
 * recording", which is the only genuinely hard part of this plugin.
 *
 * Everything downstream of a match is a field copy. A wrong match is worse
 * than no match at all: it does not show up as an error anywhere, it shows up
 * as the DJ confidently introducing the wrong song. So the default is to
 * refuse, and every relaxation here is deliberate.
 */

import type { TrackRef } from '@deadair/plugin-sdk';

import type { MusicBrainzArtistCredit, MusicBrainzRecording, MusicBrainzSearchRecording } from './musicbrainz.types.js';

/** Lucene syntax characters, which have to survive as literals inside a phrase. */
const LUCENE_SPECIALS = /[+\-&|!(){}[\]^"~*?:\\/]/g;

/** Kept apart from the general punctuation strip: these carry the "which version" information. */
const PARENTHETICAL = /[([{].*?[)\]}]/g;

/** Everything that is decoration rather than identity once a string is lowercased. */
const PUNCTUATION = /[^\p{Letter}\p{Number}\s]/gu;

/** Within this much of the reference duration, the candidate is the same performance. */
const DURATION_EXACT_MS = 3_000;

/** Beyond this, it is an edit, a live take, or a different song with the same name. */
const DURATION_LIMIT_MS = 15_000;

/** How far a candidate's confidence moves for each thing that agrees or does not. */
const BONUS_DURATION = 5;
const BONUS_ALBUM = 5;
const PENALTY_DURATION = 20;
const PENALTY_TITLE_BASE = 5;
const PENALTY_ARTIST_PARTIAL = 5;

/** What a `/recording?query=` result scores when MusicBrainz forgot to say. */
const ASSUMED_SEARCH_SCORE = 50;

/** An ISRC lookup has no score of its own: the code already identified the recording. */
const ISRC_BASE_SCORE = 100;

/**
 * Escapes a value for use inside a quoted Lucene phrase.
 *
 * Every special is escaped rather than only the quote and the backslash. A
 * phrase is meant to be literal, but MusicBrainz's search parser still reads
 * some of these inside one, and a title like `Sgt. Pepper's (Reprise)` should
 * never be able to become part of the query's structure.
 */
export function escapeLucene(value: string): string {
    return value.replace(LUCENE_SPECIALS, character => `\\${character}`);
}

/**
 * Comparison form: lowercased, unaccented, stripped of punctuation, with runs
 * of whitespace collapsed. `Beyoncé` and `Beyonce`, `Mr. Brightside` and
 * `Mr Brightside` are the same string here.
 */
export function normalize(value: string): string {
    return value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(PUNCTUATION, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * {@link normalize} with any parenthesised suffix removed, so
 * `Song (2011 Remaster)` and `Song - Live` compare equal to `Song`.
 *
 * This is where re-issues are caught. A provider's catalog is full of
 * remasters and deluxe editions, and MusicBrainz holds the recording under its
 * plain name, so an exact-only comparison misses most of a real library.
 */
export function baseForm(value: string): string {
    return normalize(value.replace(PARENTHETICAL, ' ').split(/\s+[-–—]\s+/)[0] ?? value);
}

/** Every way an artist is named on a credit: the credited name and the artist's own. */
function creditNames(credits: MusicBrainzArtistCredit[] | undefined): string[] {
    const names: string[] = [];
    for (const credit of credits ?? []) {
        if (credit.name) names.push(credit.name);
        if (credit.artist?.name) names.push(credit.artist.name);
    }
    return names;
}

/** The credited artist as one string ("X feat. Y"), for comparing against a provider's own spelling. */
export function joinCredits(credits: MusicBrainzArtistCredit[] | undefined): string {
    return (credits ?? []).map(credit => `${credit.name ?? credit.artist?.name ?? ''}${credit.joinphrase ?? ''}`).join('');
}

type Agreement = 'exact' | 'partial' | 'none';

function compareTitle(candidate: string | undefined, reference: string): Agreement {
    if (!candidate) return 'none';
    if (normalize(candidate) === normalize(reference)) return 'exact';
    if (baseForm(candidate) === baseForm(reference)) return 'partial';
    return 'none';
}

/**
 * Whether this credit is the artist we were asked about.
 *
 * `partial` covers the two shapes a featured credit takes: the provider says
 * "X feat. Y" where MusicBrainz credits only X, or the reverse. Containment in
 * either direction is enough to keep the candidate alive, and costs it a few
 * points.
 */
function compareArtist(credits: MusicBrainzArtistCredit[] | undefined, reference: string): Agreement {
    const wanted = normalize(reference);
    if (wanted.length === 0) return 'none';

    const names = creditNames(credits).map(normalize);
    if (names.some(name => name === wanted)) return 'exact';

    const joined = normalize(joinCredits(credits));
    if (joined === wanted) return 'exact';
    if (joined.length > 0 && (joined.includes(wanted) || wanted.includes(joined))) return 'partial';
    if (names.some(name => name.length > 0 && (wanted.includes(name) || name.includes(wanted)))) return 'partial';

    return 'none';
}

/** Whether any release this recording appears on is the album the provider named. */
function matchesAlbum(recording: MusicBrainzRecording, album: string | undefined): boolean {
    if (!album) return false;
    return (recording.releases ?? []).some(release => compareTitle(release.title, album) !== 'none');
}

/**
 * The confidence that this candidate is the track we were asked about, on the
 * same 0-100 scale MusicBrainz's own search score uses, or `undefined` when
 * the candidate is not a plausible match at all.
 *
 * Disagreement on title or artist is disqualifying rather than expensive. Those
 * two are the identity of the thing; everything else (duration, album) is
 * corroboration, and corroboration should not be able to carry a candidate
 * whose name is wrong.
 */
export function scoreCandidate(recording: MusicBrainzSearchRecording, ref: TrackRef, baseScore?: number): number | undefined {
    const title = compareTitle(recording.title, ref.title);
    if (title === 'none') return undefined;

    const artist = compareArtist(recording['artist-credit'], ref.artist);
    if (artist === 'none') return undefined;

    let score = baseScore ?? recording.score ?? ASSUMED_SEARCH_SCORE;

    if (title === 'partial') score -= PENALTY_TITLE_BASE;
    if (artist === 'partial') score -= PENALTY_ARTIST_PARTIAL;

    if (ref.durationMs !== undefined && recording.length !== undefined) {
        const delta = Math.abs(recording.length - ref.durationMs);
        if (delta <= DURATION_EXACT_MS) score += BONUS_DURATION;
        else if (delta > DURATION_LIMIT_MS) score -= PENALTY_DURATION;
    }

    if (matchesAlbum(recording, ref.album)) score += BONUS_ALBUM;

    return Math.max(0, Math.min(100, score));
}

/** `YYYY`, `YYYY-MM` and `YYYY-MM-DD` all sort correctly as strings; a missing date sorts last. */
const releaseDateOrder = (recording: MusicBrainzRecording): string => recording['first-release-date'] || '9999';

export interface RecordingMatch {
    recording: MusicBrainzRecording;
    score: number;
}

/**
 * The best of a set of candidates, or `undefined` when none of them clear
 * `minScore`.
 *
 * Ties break towards the earliest first release, which is the original rather
 * than a compilation or a re-issue: the year the DJ should be saying out loud,
 * and the release most likely to have the artwork and the label.
 */
export function selectRecording(candidates: MusicBrainzSearchRecording[], ref: TrackRef, minScore: number): RecordingMatch | undefined {
    const scored: RecordingMatch[] = [];

    for (const recording of candidates) {
        if (!recording.id) continue;
        const score = scoreCandidate(recording, ref);
        if (score !== undefined && score >= minScore) scored.push({ recording, score });
    }

    scored.sort((left, right) => right.score - left.score || releaseDateOrder(left.recording).localeCompare(releaseDateOrder(right.recording)));

    return scored[0];
}

/**
 * The best of the recordings carrying an ISRC.
 *
 * The bar is lower here than in {@link selectRecording} on purpose: the code
 * is a stronger identifier than any string comparison, so a candidate that
 * merely fails to *disagree* is accepted, and the scoring is only used to pick
 * between the several recordings a code often maps to. When the strings
 * disagree with every candidate the first is still taken, because an ISRC that
 * resolves at all is evidence and a provider's spelling is not.
 */
export function selectByIsrc(candidates: MusicBrainzRecording[], ref: TrackRef): RecordingMatch | undefined {
    const usable = candidates.filter(recording => recording.id);
    if (usable.length === 0) return undefined;

    const scored: RecordingMatch[] = [];
    for (const recording of usable) {
        const score = scoreCandidate(recording, ref, ISRC_BASE_SCORE);
        if (score !== undefined) scored.push({ recording, score });
    }

    if (scored.length === 0) return { recording: usable[0]!, score: ISRC_BASE_SCORE };

    scored.sort((left, right) => right.score - left.score || releaseDateOrder(left.recording).localeCompare(releaseDateOrder(right.recording)));
    return scored[0];
}

/**
 * The Lucene query for a recording search: the title and the artist, both
 * required, both as literal phrases.
 *
 * The album is deliberately not in the query. A provider's album name is
 * frequently a deluxe edition, a compilation, or a regional variant the
 * recording is not indexed under, so requiring it loses real matches, and
 * offering it as an optional clause only reorders results this plugin
 * re-scores anyway. It earns its keep locally instead: search results carry
 * their `releases`, so {@link scoreCandidate} can reward an album that agrees
 * without a query that punishes one that does not.
 */
export function buildRecordingQuery(ref: TrackRef): string {
    return `recording:"${escapeLucene(ref.title)}" AND artist:"${escapeLucene(ref.artist)}"`;
}
