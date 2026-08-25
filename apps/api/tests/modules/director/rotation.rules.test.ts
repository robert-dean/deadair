// Every rule here is a small decision that is easy to get subtly wrong and
// impossible to hear going wrong. A repeat window that never matches sounds
// exactly like a station with a small library, and a cooldown keyed on the wrong
// thing is dodged by every track with a guest artist on it. So these are tested
// against the cases that produce those silences, not just the happy path.

import { settingsConfig } from '../../utils/settings.config.js';
import { describe, expect, it } from 'vitest';

import { artistKey, songKey } from '../../../src/modules/director/rotation.keys.js';
import {
    capPerArtist,
    DEFAULT_RULES,
    filterByHistory,
    rejectDisliked,
    resolveRules,
    stationRules,
    ROTATION_KEYS,
    spaceArtists,
    weightOf,
    type RotationCandidate,
} from '../../../src/modules/director/rotation.rules.js';

const candidate = (title: string, artists: string[], rating?: number): RotationCandidate => ({
    songKey: songKey(title, artists),
    artistKey: artistKey(artists),
    ...(rating === undefined ? {} : { rating }),
});

const none = { songKeys: new Set<string>(), artistKeys: new Set<string>() };

/** Every ordering of a small batch, for a rule that must not depend on the order it is given. */
function permutations<T>(items: readonly T[]): T[][] {
    if (items.length <= 1) return [[...items]];

    return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]));
}

describe('rotation keys', () => {
    it('counts a featured credit as the lead artist', () => {
        // Otherwise a cooldown is dodged by any track with a guest on it, which is
        // the common case in exactly the genres with a deep catalogue to work through.
        expect(artistKey(['Aphex Twin', 'Someone Else'])).toBe(artistKey(['Aphex Twin']));
    });

    it('folds the spellings the catalog folds', () => {
        expect(artistKey(['Beyoncé'])).toBe(artistKey(['Beyonce']));
        expect(songKey("Don't Stop Me Now", ['Queen'])).toBe(songKey('Dont Stop Me Now', ['Queen']));
    });

    it('keeps two acts sharing a title apart', () => {
        // "Crazy" by two different artists is two songs, and suppressing one because
        // the other aired would be wrong.
        expect(songKey('Crazy', ['Gnarls Barkley'])).not.toBe(songKey('Crazy', ['Patsy Cline']));
    });

    it('treats a track credited to nobody as matching nothing', () => {
        // The alternative herds every uncredited track under one key and cools them
        // all down together.
        expect(artistKey([])).toBe('');
    });
});

describe('resolveRules', () => {
    it('gives a rotation the station defaults', () => {
        expect(resolveRules('rotation')).toEqual(DEFAULT_RULES);
    });

    it('turns everything off for a setlist', () => {
        // The whole mechanism behind a Christmas list: it is played across a month
        // precisely because it repeats, and a repeat window would suppress the very
        // tracks it exists to play.
        expect(resolveRules('setlist')).toEqual({
            repeatWindowDays: 0,
            artistCooldownMinutes: 0,
            maxPerArtist: 0,
            autoExtend: false,
            // Somebody sequenced this list. Dropping an ident into the middle of their sequence is
            // undoing the work, which is the same argument the 0007 migration makes about a
            // feature's segues, one step weaker.
            breaks: false,
            // Including a greeting, which is a break like any other: an album played in full does
            // not stop halfway to introduce itself to whoever just arrived.
            welcome: false,
            breakEveryMinutes: 0,
            // And the same argument again for a phone-in, which is a break's worth of
            // intrusion several times over: an album side interrupted by somebody
            // ringing in is exactly what this mode exists to prevent.
            callins: false,
            callinEveryMinutes: 0,
            // Same argument, one step further: somebody decided where these records stop
            // and start, and overlapping two of them overrules that decision.
            crossfade: false,
        });
    });

    it('turns everything off for a feature, which is one artist by definition', () => {
        expect(resolveRules('feature').artistCooldownMinutes).toBe(0);
        expect(resolveRules('feature').autoExtend).toBe(false);
    });

    it('leaves an album cold, which is the case crossfade exists to except', () => {
        // A feature is an album played in full, and 0007 says why nothing talks over
        // one. Blending its boundaries is the same intrusion applied to the segues
        // themselves, so it falls out of the same baseline rather than a branch.
        expect(resolveRules('feature').crossfade).toBe(false);
        expect(resolveRules('setlist').crossfade).toBe(false);
    });

    it('lets a sequenced order ask to be blended anyway', () => {
        // The baseline is a default, not a rule about what a setlist is allowed to be.
        expect(resolveRules('setlist', { crossfade: true }).crossfade).toBe(true);
    });

    it('lets a rotation keep its boundaries cold', () => {
        const station = { ...DEFAULT_RULES, crossfade: true };

        expect(resolveRules('rotation', undefined, station).crossfade).toBe(true);
        expect(resolveRules('rotation', { crossfade: false }, station).crossfade).toBe(false);
    });

    it('lets a lineup override the baseline field by field', () => {
        // An operator who wants a cooldown inside a long setlist can have one; that
        // is why the mode sets a baseline rather than branching in the reactor.
        const rules = resolveRules('setlist', { artistCooldownMinutes: 30 });

        expect(rules.artistCooldownMinutes).toBe(30);
        expect(rules.repeatWindowDays).toBe(0);
    });

    it('lets a rotation turn a rule off with zero, rather than reading it as unset', () => {
        expect(resolveRules('rotation', { repeatWindowDays: 0 }).repeatWindowDays).toBe(0);
    });

    it('lets a rotation turn auto-extend off', () => {
        expect(resolveRules('rotation', { autoExtend: false }).autoExtend).toBe(false);
    });

    it('takes the station settings as a rotation baseline, under the lineup', () => {
        // Precedence, tightest last. An operator sets the station's own rules once; a lineup that
        // wants something different still says so for itself.
        const station = { ...DEFAULT_RULES, breakEveryMinutes: 2, repeatWindowDays: 7 };

        const rules = resolveRules('rotation', { repeatWindowDays: 1 }, station);

        expect(rules.breakEveryMinutes).toBe(2);
        expect(rules.repeatWindowDays).toBe(1);
    });

    it('keeps the station settings out of a setlist and a feature', () => {
        // A station-wide cooldown leaking into these would undo the thing they exist for, which is
        // why the mode is read before the station rules rather than after them.
        const station = { ...DEFAULT_RULES, artistCooldownMinutes: 90, breaks: true };

        expect(resolveRules('setlist', undefined, station).artistCooldownMinutes).toBe(0);
        expect(resolveRules('feature', undefined, station).breaks).toBe(false);
    });
});

describe('stationRules', () => {
    it('is the defaults for a station that has set none of them', () => {
        expect(stationRules(settingsConfig().config)).toEqual(DEFAULT_RULES);
    });

    it('takes only the fields an operator has actually set', () => {
        // Per field, not all-or-nothing: somebody who only ever changed how often the station says
        // its name keeps the reasoning behind everything else.
        const { config } = settingsConfig({ [ROTATION_KEYS.breakEveryMinutes]: '2' });

        expect(stationRules(config)).toEqual({ ...DEFAULT_RULES, breakEveryMinutes: 2 });
    });

    it('reads zero as zero rather than as unset', () => {
        // `0` is how a rule is turned off, so treating a falsy value as absent would make the one
        // setting an operator most wants impossible to express.
        const { config } = settingsConfig({ [ROTATION_KEYS.repeatWindowDays]: '0' });

        expect(stationRules(config).repeatWindowDays).toBe(0);
    });

    it('ignores a stored value that is not a number', () => {
        // These reach SQL as a window and a cooldown, where a NaN quietly matches nothing — which
        // sounds exactly like a library too small to fill an afternoon.
        const { config } = settingsConfig({ [ROTATION_KEYS.artistCooldownMinutes]: 'forty' });

        expect(stationRules(config).artistCooldownMinutes).toBe(DEFAULT_RULES.artistCooldownMinutes);
    });

    it('ignores a negative window rather than passing it down', () => {
        const { config } = settingsConfig({ [ROTATION_KEYS.repeatWindowDays]: '-3' });

        expect(stationRules(config).repeatWindowDays).toBe(DEFAULT_RULES.repeatWindowDays);
    });

    it('reads the strings a settings row stores, which is the only form these ever arrive in', () => {
        expect(stationRules(settingsConfig({ [ROTATION_KEYS.breaks]: 'false' }).config).breaks).toBe(false);
        expect(stationRules(settingsConfig({ [ROTATION_KEYS.breaks]: 'true' }).config).breaks).toBe(true);
    });

    it('takes the default for a value it cannot read, where it used to read anything as ON', () => {
        // This resolved `!== 'false'`, which got the important case right and then treated every
        // unparseable row as a yes. These four switches decide whether the station talks at all, so
        // "I could not read it" should land on the considered default rather than on true.
        expect(stationRules(settingsConfig({ [ROTATION_KEYS.breaks]: 'banana' }).config).breaks).toBe(DEFAULT_RULES.breaks);
        expect(stationRules(settingsConfig({ [ROTATION_KEYS.crossfade]: '' }).config).crossfade).toBe(DEFAULT_RULES.crossfade);
    });

    it('shares one vocabulary with every other switch', () => {
        expect(stationRules(settingsConfig({ [ROTATION_KEYS.welcome]: 'off' }).config).welcome).toBe(false);
        expect(stationRules(settingsConfig({ [ROTATION_KEYS.autoExtend]: '0' }).config).autoExtend).toBe(false);
    });
});

describe('filterByHistory', () => {
    it('drops a song inside the repeat window', () => {
        const recent = { songKeys: new Set([songKey('A', ['One'])]), artistKeys: new Set<string>() };

        expect(filterByHistory([candidate('A', ['One']), candidate('B', ['Two'])], recent).map(c => c.songKey)).toEqual([songKey('B', ['Two'])]);
    });

    it('drops every song by an artist inside the cooldown', () => {
        const recent = { songKeys: new Set<string>(), artistKeys: new Set([artistKey(['One'])]) };

        expect(filterByHistory([candidate('A', ['One']), candidate('B', ['One'])], recent)).toEqual([]);
    });

    it('suppresses nothing when the windows are empty', () => {
        // Which is also what a disabled rule produces, so `0` costs no query rather
        // than needing a branch at the call site.
        expect(filterByHistory([candidate('A', ['One'])], none)).toHaveLength(1);
    });
});

describe('rejectDisliked', () => {
    it('drops a disliked candidate', () => {
        expect(rejectDisliked([candidate('A', ['One'], -1), candidate('B', ['Two'], 0)]).map(c => c.songKey)).toEqual([songKey('B', ['Two'])]);
    });

    it('keeps everything the catalog has no opinion on', () => {
        expect(rejectDisliked([candidate('A', ['One'])])).toHaveLength(1);
    });

    it('favours a liked track without promising it', () => {
        expect(weightOf(candidate('A', ['One'], 1))).toBe(2);
        expect(weightOf(candidate('B', ['Two'], 0))).toBe(1);
    });
});

describe('capPerArtist', () => {
    it('keeps at most the cap, in the order offered', () => {
        const picks = [candidate('A', ['One']), candidate('B', ['One']), candidate('C', ['One']), candidate('D', ['Two'])];

        expect(capPerArtist(picks, 2).map(c => c.songKey)).toEqual([songKey('A', ['One']), songKey('B', ['One']), songKey('D', ['Two'])]);
    });

    it('is disabled by zero', () => {
        const picks = [candidate('A', ['One']), candidate('B', ['One'])];

        expect(capPerArtist(picks, 0)).toHaveLength(2);
    });
});

describe('spaceArtists', () => {
    it('never puts the same artist back to back', () => {
        // Two tracks by one act in a row is the most audible sign of a shuffle that
        // is not being programmed, and the cap alone cannot prevent it.
        const spaced = spaceArtists([candidate('A', ['One']), candidate('B', ['One']), candidate('C', ['Two'])]);

        expect(spaced.map(c => c.artistKey)).toEqual([artistKey(['One']), artistKey(['Two']), artistKey(['One'])]);
    });

    it('keeps every candidate it was given', () => {
        const picks = [candidate('A', ['One']), candidate('B', ['One']), candidate('C', ['Two']), candidate('D', ['Three'])];

        expect(spaceArtists(picks)).toHaveLength(4);
        expect(new Set(spaceArtists(picks).map(c => c.songKey)).size).toBe(4);
    });

    it('spends the crowded artist early rather than stranding them at the end', () => {
        // The case a first-different-artist pass gets wrong: it places Two, Three,
        // One, and then has only One left, so the two One tracks end up adjacent even
        // though One-Two-One-Three exists. Found by a flaky generator test.
        const spaced = spaceArtists([candidate('C', ['Two']), candidate('D', ['Three']), candidate('A', ['One']), candidate('B', ['One'])]);

        const artists = spaced.map(c => c.artistKey);
        expect(artists.every((artist, index) => index === 0 || artist !== artists[index - 1])).toBe(true);
    });

    it('separates the same artist however the batch arrives', () => {
        // Every ordering of two tracks by one artist among two others has a valid
        // arrangement, so none of them may come back adjacent.
        const batch = [candidate('A', ['One']), candidate('B', ['One']), candidate('C', ['Two']), candidate('D', ['Three'])];

        for (const order of permutations(batch)) {
            const artists = spaceArtists(order).map(c => c.artistKey);
            expect(artists.every((artist, index) => index === 0 || artist !== artists[index - 1])).toBe(true);
        }
    });

    it('gives back a single-artist batch in its original order rather than stalling', () => {
        // Nothing can be done about it, and looping forever looking for a different
        // artist is the failure mode a greedy pass has to be written against.
        const picks = [candidate('A', ['One']), candidate('B', ['One'])];

        expect(spaceArtists(picks).map(c => c.songKey)).toEqual([songKey('A', ['One']), songKey('B', ['One'])]);
    });

    it('handles an empty batch', () => {
        expect(spaceArtists([])).toEqual([]);
    });
});
