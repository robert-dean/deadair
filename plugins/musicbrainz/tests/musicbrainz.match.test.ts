import { describe, expect, it } from 'vitest';

import { baseForm, normalize, type TrackRef } from '@deadair/plugin-sdk';

import {
    albumSearchTitle,
    buildRecordingQuery,
    escapeLucene,
    joinCredits,
    scoreCandidate,
    selectByIsrc,
    selectRecording,
} from '../src/musicbrainz.match.js';
import type { MusicBrainzRecording, MusicBrainzSearchRecording } from '../src/musicbrainz.types.js';

const ref = (overrides: Partial<TrackRef> = {}): TrackRef => ({ artist: 'Portishead', title: 'Glory Box', ...overrides });

const recording = (overrides: Partial<MusicBrainzSearchRecording> = {}): MusicBrainzSearchRecording => ({
    id: 'rec-1',
    title: 'Glory Box',
    score: 100,
    'artist-credit': [{ name: 'Portishead', artist: { id: 'art-1', name: 'Portishead' } }],
    ...overrides,
});

describe('normalize', () => {
    it('folds case, accents and punctuation', () => {
        expect(normalize('Beyoncé')).toBe('beyonce');
        expect(normalize('Mr. Brightside')).toBe('mr brightside');
        expect(normalize('  Sgt.   Pepper  ')).toBe('sgt pepper');
    });
});

describe('baseForm', () => {
    it('drops the parenthesised and dashed suffixes a re-issue carries', () => {
        expect(baseForm('Glory Box (2011 Remaster)')).toBe('glory box');
        expect(baseForm('Glory Box - Live')).toBe('glory box');
        expect(baseForm('Glory Box')).toBe('glory box');
    });
});

describe('escapeLucene', () => {
    it('neutralises the syntax characters a title can contain', () => {
        expect(escapeLucene("Sgt. Pepper's (Reprise)")).toBe("Sgt. Pepper's \\(Reprise\\)");
        expect(escapeLucene('AC/DC')).toBe('AC\\/DC');
        expect(escapeLucene('C++')).toBe('C\\+\\+');
    });
});

describe('buildRecordingQuery', () => {
    it('requires the title and the artist, and leaves the album out', () => {
        expect(buildRecordingQuery(ref({ album: 'Dummy' }))).toBe('recording:"Glory Box" AND artist:"Portishead"');
    });
});

describe('joinCredits', () => {
    it('rebuilds the credit line the release printed', () => {
        expect(joinCredits([{ name: 'Portishead', joinphrase: ' feat. ' }, { name: 'Beth Gibbons' }])).toBe('Portishead feat. Beth Gibbons');
    });
});

describe('scoreCandidate', () => {
    it('rejects a candidate whose title disagrees', () => {
        expect(scoreCandidate(recording({ title: 'Sour Times' }), ref())).toBeUndefined();
    });

    it('rejects a candidate whose artist disagrees', () => {
        expect(scoreCandidate(recording({ 'artist-credit': [{ name: 'Massive Attack' }] }), ref())).toBeUndefined();
    });

    it('accepts a remaster at a small cost', () => {
        const exact = scoreCandidate(recording(), ref())!;
        const remaster = scoreCandidate(recording({ title: 'Glory Box (2011 Remaster)' }), ref())!;
        expect(remaster).toBeLessThan(exact);
        expect(remaster).toBeGreaterThan(80);
    });

    it('accepts a featured credit the provider spelled out in full', () => {
        const score = scoreCandidate(recording(), ref({ artist: 'Portishead feat. Beth Gibbons' }));
        expect(score).toBeDefined();
    });

    it('rewards a duration that agrees and punishes one that does not', () => {
        const close = scoreCandidate(recording({ length: 301_000, score: 90 }), ref({ durationMs: 300_000 }))!;
        const far = scoreCandidate(recording({ length: 500_000, score: 90 }), ref({ durationMs: 300_000 }))!;
        expect(close).toBe(95);
        expect(far).toBe(70);
    });

    it('rewards an album that agrees', () => {
        const score = scoreCandidate(recording({ score: 90, releases: [{ id: 'rel-1', title: 'Dummy' }] }), ref({ album: 'Dummy' }))!;
        expect(score).toBe(95);
    });

    it('never leaves the 0-100 scale', () => {
        expect(
            scoreCandidate(
                recording({ score: 100, length: 300_000, releases: [{ id: 'r', title: 'Dummy' }] }),
                ref({ durationMs: 300_000, album: 'Dummy' }),
            ),
        ).toBe(100);
    });
});

describe('selectRecording', () => {
    it('returns nothing when no candidate clears the bar', () => {
        expect(selectRecording([recording({ score: 60 })], ref(), 90)).toBeUndefined();
    });

    it('skips a candidate with no id, which is not something we could look up', () => {
        expect(selectRecording([recording({ id: undefined })], ref(), 90)).toBeUndefined();
    });

    it('breaks a tie towards the earliest first release', () => {
        const later = recording({ id: 'comp', 'first-release-date': '2008-10-01' });
        const original = recording({ id: 'orig', 'first-release-date': '1994-08-08' });
        expect(selectRecording([later, original], ref(), 90)?.recording.id).toBe('orig');
    });

    it('prefers the higher score over the earlier release', () => {
        const early = recording({ id: 'early', score: 91, 'first-release-date': '1990-01-01' });
        const strong = recording({ id: 'strong', score: 100, 'first-release-date': '2000-01-01' });
        expect(selectRecording([early, strong], ref(), 90)?.recording.id).toBe('strong');
    });
});

describe('selectByIsrc', () => {
    const byIsrc = (overrides: Partial<MusicBrainzRecording> = {}): MusicBrainzRecording => ({ id: 'rec-1', title: 'Glory Box', ...overrides });

    it('takes the first recording even when the strings disagree, because the code is the match', () => {
        const odd = byIsrc({ id: 'odd', title: 'Glory Box (Alternate Mix)', 'artist-credit': [{ name: 'Someone Else' }] });
        expect(selectByIsrc([odd], ref())?.recording.id).toBe('odd');
    });

    it('still prefers the candidate that agrees when there are several', () => {
        const wrong = byIsrc({ id: 'wrong', 'artist-credit': [{ name: 'Someone Else' }] });
        const right = byIsrc({ id: 'right', 'artist-credit': [{ name: 'Portishead' }] });
        expect(selectByIsrc([wrong, right], ref())?.recording.id).toBe('right');
    });

    it('returns nothing when the code resolved to no recordings', () => {
        expect(selectByIsrc([], ref())).toBeUndefined();
    });
});

describe('albumSearchTitle', () => {
    /** Pressing detail a provider prints, which MusicBrainz keeps on the release. */
    it.each([
        ['Jagged Little Pill (2015 Remaster)', 'Jagged Little Pill'],
        ['First Band On The Moon (Remastered)', 'First Band On The Moon'],
        ['Check Your Head (Deluxe Edition/Remastered/2009)', 'Check Your Head'],
        ['Garbage (20th Anniversary Deluxe Edition/Remastered)', 'Garbage'],
        ['Mellon Collie And The Infinite Sadness (Deluxe Edition)', 'Mellon Collie And The Infinite Sadness'],
        ['Rust In Peace (2004 Remix / Expanded Edition)', 'Rust In Peace'],
        ['...And Justice for All (Remastered Deluxe Box Set)', '...And Justice for All'],
        ['Moving Pictures (2011 Remaster)', 'Moving Pictures'],
        ['Nevermind - Remastered', 'Nevermind'],
        ['Ride The Lightning (Deluxe Remaster)', 'Ride The Lightning'],
    ])('takes the pressing detail off %s', (raw, expected) => {
        expect(albumSearchTitle(raw)).toBe(expected);
    });

    /**
     * The regression this replaced `baseForm` for. A comparison form strips
     * punctuation so two strings we both hold compare equal; a query has to
     * survive being read by a service whose index has the original.
     */
    it.each([
        "School's Out",
        "Why Can't We Be Friends?",
        'The Raw & The Cooked',
        'George Thorogood & the Destroyers',
        "Don't Shoot Me I'm Only The Piano Player",
        'R&G (Rhythm & Gangsta): The Masterpiece',
        "(What's the Story) Morning Glory?",
        'Sgt. Pepper’s Lonely Hearts Club Band',
    ])('leaves %s exactly as it is', raw => {
        expect(albumSearchTitle(raw)).toBe(raw);
    });

    it('keeps a dash that is part of the title rather than a pressing suffix', () => {
        expect(albumSearchTitle('Songs for the Deaf - Live')).toBe('Songs for the Deaf - Live');
    });

    it('falls back to the raw title when there would be nothing left to search for', () => {
        expect(albumSearchTitle('(Deluxe Edition)')).toBe('(Deluxe Edition)');
    });

    it('collapses the whitespace a removed group leaves behind', () => {
        expect(albumSearchTitle('Aqualung  (25th Anniversary Edition)')).toBe('Aqualung');
    });
});
