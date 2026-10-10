// Every rule here is a small decision that is easy to get subtly wrong and
// impossible to hear going wrong. A repeat window that never matches sounds
// exactly like a station with a small library, and a cooldown keyed on the wrong
// thing is dodged by every track with a guest artist on it. So these are tested
// against the cases that produce those silences, not just the happy path.

import { settingsConfig } from '../../utils/settings.config.js';
import { describe, expect, it } from 'vitest';

import { albumKey, artistKey, songKey } from '../../../src/modules/director/rotation.keys.js';
import {
    applyRules,
    applyRulesHoldingQueue,
    capPerAlbum,
    capPerArtist,
    DEFAULT_AUTO_EXTEND,
    DEFAULT_RULES,
    filterByHistory,
    FRESH_FLOOR,
    holdArtistCooldown,
    MIX_IN_EVERY_RANGE,
    NO_RULES,
    stationAutoExtends,
    rejectDisliked,
    resolveRules,
    stationRules,
    ROTATION_KEYS,
    spaceArtists,
    weightOf,
    type RotationCandidate,
} from '../../../src/modules/director/rotation.rules.js';
import { DEEP_CUT_LEAN, RETURN_LEAN } from '../../../src/modules/director/rediscover.js';

const candidate = (title: string, artists: string[], rating?: number, album?: string): RotationCandidate => ({
    songKey: songKey(title, artists),
    artistKey: artistKey(artists),
    ...(rating === undefined ? {} : { rating }),
    ...(album === undefined ? {} : { albumKey: albumKey(artists, album) }),
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

    it('folds the same spellings and casing for an album key', () => {
        expect(albumKey(['Beyoncé'], 'Lemonade')).toBe(albumKey(['Beyonce'], 'lemonade'));
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
            maxPerAlbum: 0,
            mayGenerate: false,
            // Somebody sequenced this list. Dropping an ident into the middle of their sequence is
            // undoing the work, which is the same argument the 0007 migration makes about a
            // feature's segues, one step weaker.
            breaks: false,
            // Including a greeting, which is a break like any other: an album played in full does
            // not stop halfway to introduce itself to whoever just arrived.
            welcome: false,
            // A change of programme into a setlist is not marked either: the break would air inside
            // the setlist, which takes none.
            changeovers: false,
            breakEveryMinutes: 0,
            // A jingle between two of their records is an ident by another name.
            jingleEveryMinutes: 0,
            // And the same argument again for a phone-in, which is a break's worth of
            // intrusion several times over: an album side interrupted by somebody
            // ringing in is exactly what this mode exists to prevent.
            callins: false,
            callinEveryMinutes: 0,
            // Same argument, one step further: somebody decided where these records stop
            // and start, and overlapping two of them overrules that decision.
            crossfade: false,
            // And the station choosing records to put among theirs is generating into a
            // sequence somebody made by hand.
            mixInSimilar: false,
            mixInEvery: 0,
        });
    });

    it('never mixes anything into a setlist or a feature, even when the broadcast asks', () => {
        // Unlike crossfade, which a setlist may ask for. Mixing in is the station CHOOSING records,
        // and nothing may be generated into a mode that is given rather than programmed.
        expect(resolveRules('setlist', { mixInSimilar: true }).mixInSimilar).toBe(false);
        expect(resolveRules('feature', { mixInSimilar: true }).mixInSimilar).toBe(false);
    });

    it('lets a rotation broadcast ask for records to be mixed in, or decline the station default', () => {
        expect(resolveRules('rotation', { mixInSimilar: true }).mixInSimilar).toBe(true);

        const station = { ...DEFAULT_RULES, mixInSimilar: true, mixInEvery: 6 };
        expect(resolveRules('rotation', undefined, station)).toMatchObject({ mixInSimilar: true, mixInEvery: 6 });
        expect(resolveRules('rotation', { mixInSimilar: false }, station).mixInSimilar).toBe(false);
    });

    it('turns everything off for a feature, which is one artist by definition', () => {
        expect(resolveRules('feature').artistCooldownMinutes).toBe(0);
        expect(resolveRules('feature').mayGenerate).toBe(false);
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

    it('lets no broadcast override whether it may be generated into, because that is its mode', () => {
        // The one rule with no override, and it used to have one under the name `autoExtend`. A
        // setlist is given rather than programmed, so "generate into this setlist" is not a
        // preference to honour — and a rotation that wants to stop rather than top itself up says
        // so with `onEnd`, which is a property of the broadcast rather than of the rules.
        expect(resolveRules('rotation').mayGenerate).toBe(true);
        expect(resolveRules('setlist').mayGenerate).toBe(false);
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

describe('resolveRules, for a setlist told to talk', () => {
    // A chart countdown is a setlist with a host. Before this, `breaks: true` on a setlist turned
    // breaks on with a spacing of zero, which is breaks off, so a scheduled countdown on the live
    // station played 31 records with nobody between them.
    const station = { ...DEFAULT_RULES, breakEveryMinutes: 6, jingleEveryMinutes: 20, welcome: true, changeovers: true, artistCooldownMinutes: 40 };

    it("takes the station's spacing for breaks and jingles", () => {
        expect(resolveRules('setlist', { breaks: true }, station)).toMatchObject({ breaks: true, breakEveryMinutes: 6, jingleEveryMinutes: 20 });
    });

    it('greets a new listener and marks a change of programme, as the station does', () => {
        expect(resolveRules('setlist', { breaks: true }, station)).toMatchObject({ welcome: true, changeovers: true });
    });

    it('still lets the broadcast set its own spacing and greeting', () => {
        expect(resolveRules('setlist', { breaks: true, breakEveryMinutes: 10, welcome: false }, station)).toMatchObject({
            breakEveryMinutes: 10,
            welcome: false,
        });
    });

    it('leaves everything about the records exactly as a setlist has it', () => {
        // The order is somebody's, a chart's here: nothing cut from it by a cooldown or a cap, nothing
        // generated or mixed into it, and nobody ringing in unless the broadcast asks for that too.
        expect(resolveRules('setlist', { breaks: true }, { ...station, mixInSimilar: true, crossfade: true })).toMatchObject({
            repeatWindowDays: 0,
            artistCooldownMinutes: 0,
            maxPerArtist: 0,
            maxPerAlbum: 0,
            mayGenerate: false,
            mixInSimilar: false,
            callins: false,
            crossfade: false,
        });
    });

    it('stays silent when the broadcast says nothing, so an existing setlist is unchanged', () => {
        expect(resolveRules('setlist', undefined, station)).toEqual(NO_RULES);
        expect(resolveRules('setlist', { breaks: false }, station)).toMatchObject({ breakEveryMinutes: 0, jingleEveryMinutes: 0, welcome: false });
    });

    it('leaves a feature cold whatever it asks, since nothing talks over an album played whole', () => {
        expect(resolveRules('feature', { breaks: true }, station)).toMatchObject({ breakEveryMinutes: 0, jingleEveryMinutes: 0, changeovers: false });
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

    it('takes no calls whatever a leftover `rotation.callins` row says', () => {
        // Calls are a programme's answer alone. A station default that a broadcast saying nothing
        // inherited is how an unticked box aired callers.
        const { config } = settingsConfig({ 'rotation.callins': 'true' });

        expect(stationRules(config).callins).toBe(false);
        expect(resolveRules('rotation', undefined, stationRules(config)).callins).toBe(false);
        expect(resolveRules('rotation', { callins: true }, stationRules(config)).callins).toBe(true);
    });

    it('leaves jingles off until an operator sets a spacing, and reads the one they set', () => {
        expect(stationRules(settingsConfig().config).jingleEveryMinutes).toBe(0);
        expect(stationRules(settingsConfig({ [ROTATION_KEYS.jingleEveryMinutes]: '12' }).config).jingleEveryMinutes).toBe(12);
        expect(stationRules(settingsConfig({ [ROTATION_KEYS.jingleEveryMinutes]: 'often' }).config).jingleEveryMinutes).toBe(0);
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
    });

    it('marks a change of programme unless told not to, and hears "false" as no', () => {
        // The off-case as the STRING a settings row holds, which is the only form that proves anything
        // here: a real boolean passes whether the switch is read properly or not.
        expect(stationRules(settingsConfig().config).changeovers).toBe(true);
        expect(stationRules(settingsConfig({ [ROTATION_KEYS.changeovers]: 'false' }).config).changeovers).toBe(false);
    });

    it('reads the album cap as the string a settings row stores', () => {
        const { config } = settingsConfig({ [ROTATION_KEYS.maxPerAlbum]: '2' });

        expect(stationRules(config).maxPerAlbum).toBe(2);
    });

    it('falls back to the default album cap on an unparseable value', () => {
        const { config } = settingsConfig({ [ROTATION_KEYS.maxPerAlbum]: 'banana' });

        expect(stationRules(config).maxPerAlbum).toBe(DEFAULT_RULES.maxPerAlbum);
    });

    it('reads the mix-in switch as the string it is, off by default', () => {
        // The off-case through the string, because a real boolean passes either way.
        expect(DEFAULT_RULES.mixInSimilar).toBe(false);
        expect(stationRules(settingsConfig({ [ROTATION_KEYS.mixInSimilar]: 'false' }).config).mixInSimilar).toBe(false);
        expect(stationRules(settingsConfig({ [ROTATION_KEYS.mixInSimilar]: 'true' }).config).mixInSimilar).toBe(true);
    });

    it('clamps the mix-in spacing into range rather than refusing a stored row', () => {
        const every = (value: string) => stationRules(settingsConfig({ [ROTATION_KEYS.mixInEvery]: value }).config).mixInEvery;

        expect(every('6')).toBe(6);
        expect(every('0')).toBe(MIX_IN_EVERY_RANGE.min);
        expect(every('500')).toBe(MIX_IN_EVERY_RANGE.max);
        expect(every('2.7')).toBe(2);
        expect(every('banana')).toBe(DEFAULT_RULES.mixInEvery);
    });

    it('does not read auto-extend, because that decides a default rather than a rule', () => {
        // `rotation.autoExtend` used to resolve into these rules, and both refill jobs read it as
        // permission to run — so turning it off silently took the console's Replan button with it.
        // It answers one question now, in one place: what a NEW broadcast's `onEnd` starts as.
        expect(stationRules(settingsConfig({ [ROTATION_KEYS.autoExtend]: '0' }).config).mayGenerate).toBe(true);
    });
});

describe('stationAutoExtends', () => {
    it('shares the vocabulary every other switch uses', () => {
        expect(stationAutoExtends(settingsConfig({ [ROTATION_KEYS.autoExtend]: '0' }).config)).toBe(false);
        expect(stationAutoExtends(settingsConfig({ [ROTATION_KEYS.autoExtend]: 'off' }).config)).toBe(false);
        expect(stationAutoExtends(settingsConfig({ [ROTATION_KEYS.autoExtend]: 'on' }).config)).toBe(true);
    });

    it('takes the default for a value it cannot read, and for one nobody set', () => {
        expect(stationAutoExtends(settingsConfig({ [ROTATION_KEYS.autoExtend]: 'banana' }).config)).toBe(DEFAULT_AUTO_EXTEND);
        expect(stationAutoExtends(settingsConfig({}).config)).toBe(DEFAULT_AUTO_EXTEND);
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

describe('weightOf under smart shuffle', () => {
    const fresh = (freshness: number, rating?: number): RotationCandidate => ({ ...candidate('A', ['One'], rating), freshness });

    it('weighs a record with no freshness exactly as it always did', () => {
        // Absent is "nothing read the history", which is every candidate a draw with smart shuffle
        // off produces. Off has to restore the old draw exactly, not approximately.
        expect(weightOf(candidate('A', ['One']))).toBe(1);
        expect(weightOf(candidate('A', ['One'], 1))).toBe(2);
    });

    it('leans against a record that just aired without ever refusing it', () => {
        // Never zero: a refusal is the repeat window's job, and a weight of nothing would be a
        // second, invisible window nobody set.
        expect(weightOf(fresh(0))).toBe(FRESH_FLOOR);
        expect(FRESH_FLOOR).toBeGreaterThan(0);
    });

    it('weighs a fully fresh record like one nothing had an opinion on', () => {
        expect(weightOf(fresh(1))).toBe(1);
    });

    it('rises evenly in between', () => {
        expect(weightOf(fresh(0.5))).toBeCloseTo(FRESH_FLOOR + (1 - FRESH_FLOOR) / 2);
    });

    it('composes with a like rather than replacing it', () => {
        // A liked record that just aired is still twice as likely as an unliked one that just aired.
        expect(weightOf(fresh(0, 1))).toBe(2 * FRESH_FLOOR);
        expect(weightOf(fresh(1, 1))).toBe(2);
    });

    it('reads a freshness outside the ramp as its nearest end', () => {
        expect(weightOf(fresh(-2))).toBe(FRESH_FLOOR);
        expect(weightOf(fresh(7))).toBe(1);
        expect(weightOf(fresh(Number.NaN))).toBe(1);
    });

    it('leans half again toward a liked artist coming back, on top of the like', () => {
        const returning: RotationCandidate = { ...candidate('A', ['One'], 1), returning: true };
        expect(weightOf(returning)).toBe(2 * RETURN_LEAN);
        expect(weightOf({ ...returning, freshness: 0 })).toBe(2 * RETURN_LEAN * FRESH_FLOOR);
    });

    it('leans half again toward a deep cut', () => {
        expect(weightOf({ ...candidate('A', ['One']), deepCut: true })).toBe(DEEP_CUT_LEAN);
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

describe('capPerAlbum', () => {
    it('keeps the first N off a release and drops the rest', () => {
        const picks = [
            candidate('A', ['One'], undefined, 'Album'),
            candidate('B', ['One'], undefined, 'Album'),
            candidate('C', ['One'], undefined, 'Album'),
            candidate('D', ['One'], undefined, 'Other Album'),
        ];

        expect(capPerAlbum(picks, 2).map(c => c.songKey)).toEqual([songKey('A', ['One']), songKey('B', ['One']), songKey('D', ['One'])]);
    });

    it('is disabled by zero', () => {
        const picks = [candidate('A', ['One'], undefined, 'Album'), candidate('B', ['One'], undefined, 'Album')];

        expect(capPerAlbum(picks, 0)).toHaveLength(2);
    });

    it('never drops a candidate with no album key', () => {
        // Every `Identified` `PickResolver` judges carries none, since a pick names a work rather
        // than a row until it has been matched, and this cap has nothing to apply to it.
        const picks = [candidate('A', ['One']), candidate('B', ['One']), candidate('C', ['One'])];

        expect(capPerAlbum(picks, 1)).toHaveLength(3);
    });
});

describe('applyRules', () => {
    it('enforces the album cap over the candidates it drops down to', () => {
        const rules = { ...DEFAULT_RULES, maxPerArtist: 0, maxPerAlbum: 1 };
        const picks = [candidate('A', ['One'], undefined, 'Album'), candidate('B', ['One'], undefined, 'Album')];

        expect(applyRules(picks, rules, none).map(c => c.songKey)).toEqual([songKey('A', ['One'])]);
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

    it('will not open with the seed’s artist', () => {
        // The batch seam this closes: without a seed, the first placement is compared against
        // nothing, so a refill can open with the artist that just closed the running order.
        const spaced = spaceArtists([candidate('A', ['One']), candidate('B', ['Two'])], artistKey(['One']));

        expect(spaced[0]?.artistKey).not.toBe(artistKey(['One']));
        expect(spaced.map(c => c.artistKey)).toEqual([artistKey(['Two']), artistKey(['One'])]);
    });

    it('ignores a seed that is not among the candidates', () => {
        // The seed is a comparison, not a member of the batch, so a seed that matches nothing here
        // changes nothing about the ordering.
        const spaced = spaceArtists([candidate('A', ['One']), candidate('B', ['Two'])], artistKey(['Three']));

        expect(spaced.map(c => c.artistKey)).toEqual([artistKey(['One']), artistKey(['Two'])]);
    });
});

describe('holdArtistCooldown', () => {
    // Four minutes a record, so the arithmetic below reads in records: ten of them is the default
    // forty-minute cooldown exactly.
    const FOUR_MINUTES = 240_000;
    const length = () => FOUR_MINUTES;
    const titles = (batch: readonly RotationCandidate[]) => batch.map(c => c.songKey);

    it('drops the capped artist whose second record spacing put eight minutes after the first', () => {
        // The case this exists for. Spacing keeps X off its own heels and nothing more: with the cap
        // at two, `[A, X, X, B, ...]` comes out `X A X B ...`, two X records eight minutes apart
        // against a forty-minute cooldown.
        const batch = [
            candidate('A', ['A']),
            candidate('X1', ['X']),
            candidate('X2', ['X']),
            candidate('B', ['B']),
            candidate('C', ['C']),
            candidate('D', ['D']),
        ];
        const spaced = spaceArtists(capPerArtist(batch, DEFAULT_RULES.maxPerArtist));
        expect(spaced.slice(0, 3).map(c => c.artistKey)).toEqual([artistKey(['X']), artistKey(['A']), artistKey(['X'])]);

        const held = holdArtistCooldown(spaced, DEFAULT_RULES.artistCooldownMinutes, length);

        expect(titles(held)).toEqual(
            titles([candidate('X1', ['X']), candidate('A', ['A']), candidate('B', ['B']), candidate('C', ['C']), candidate('D', ['D'])]),
        );
    });

    it('keeps a second record that starts a whole cooldown after the first', () => {
        const others = Array.from({ length: 9 }, (_, index) => candidate(`O${index}`, [`Other${index}`]));
        const batch = [candidate('X1', ['X']), ...others, candidate('X2', ['X'])];

        expect(holdArtistCooldown(batch, 40, length)).toHaveLength(11);
    });

    it('counts only the records it kept, since a dropped one takes no time', () => {
        // X at 0, X dropped, then eight others: the third X starts thirty-two minutes in, not
        // thirty-six, and is still too soon.
        const others = Array.from({ length: 8 }, (_, index) => candidate(`O${index}`, [`Other${index}`]));
        const batch = [candidate('X1', ['X']), candidate('X2', ['X']), ...others, candidate('X3', ['X'])];

        const held = holdArtistCooldown(batch, 40, length);

        expect(held.filter(c => c.artistKey === artistKey(['X']))).toHaveLength(1);
    });

    it('changes nothing with the cooldown off', () => {
        const batch = [candidate('X1', ['X']), candidate('A', ['A']), candidate('X2', ['X'])];

        expect(holdArtistCooldown(batch, 0, length)).toEqual(batch);
        expect(holdArtistCooldown(batch, Number.NaN, length)).toEqual(batch);
    });

    it('gives way on a library too small to honour it, keeping the earliest dropped first', () => {
        // Two artists cannot fill a batch of three forty minutes apart. A station that ran down
        // instead would be worse than one that repeats an act, so it keeps what it must, in place.
        const batch = [candidate('X1', ['X']), candidate('Y1', ['Y']), candidate('X2', ['X']), candidate('Y2', ['Y'])];

        expect(titles(holdArtistCooldown(batch, 40, length, 3))).toEqual(titles(batch.slice(0, 3)));
        expect(titles(holdArtistCooldown(batch, 40, length, 4))).toEqual(titles(batch));
        expect(titles(holdArtistCooldown(batch, 40, length))).toEqual(titles(batch.slice(0, 2)));
    });
});

describe('applyRulesHoldingQueue', () => {
    const queued = new Set([artistKey(['Queued'])]);
    const offered = [candidate('Q', ['Queued']), candidate('A', ['One']), candidate('B', ['Two'])];

    it('holds an artist queued inside the cooldown as though they had aired', () => {
        const kept = applyRulesHoldingQueue(offered, DEFAULT_RULES, none, queued, 2);

        expect(kept.map(c => c.artistKey)).toEqual([artistKey(['One']), artistKey(['Two'])]);
    });

    it('lets them back in rather than leaving the batch short', () => {
        const kept = applyRulesHoldingQueue(offered, DEFAULT_RULES, none, queued, 3);

        expect(kept).toHaveLength(3);
    });

    it('never lets an artist back in that has actually aired inside the cooldown', () => {
        const aired = { songKeys: new Set<string>(), artistKeys: new Set([artistKey(['Queued'])]) };

        expect(applyRulesHoldingQueue(offered, DEFAULT_RULES, aired, queued, 3)).toHaveLength(2);
    });

    it('lets back in no more than it needs, and only what every other rule passes', () => {
        const more = [...offered, candidate('Q2', ['Queued']), candidate('Q3', ['Queued'], -1)];

        const kept = applyRulesHoldingQueue(more, DEFAULT_RULES, none, queued, 3);

        expect(kept.map(c => c.songKey)).toEqual([songKey('Q', ['Queued']), songKey('A', ['One']), songKey('B', ['Two'])]);
    });

    it('is exactly applyRules with nothing queued', () => {
        expect(applyRulesHoldingQueue(offered, DEFAULT_RULES, none, undefined, 3)).toEqual(applyRules(offered, DEFAULT_RULES, none));
        expect(applyRulesHoldingQueue(offered, DEFAULT_RULES, none, new Set(), 3)).toEqual(applyRules(offered, DEFAULT_RULES, none));
    });
});
