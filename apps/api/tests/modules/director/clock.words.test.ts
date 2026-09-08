// The interesting property here is not which words come out, it is that the window comes out with
// them and actually contains the instant it describes. A phrasing whose window is wrong is a break
// the director drops for no reason, or worse, one it airs after the words stopped being true — and
// neither is audible until it happens on air. So the exhaustive test below walks every minute of a
// day and asserts the invariant rather than spot-checking a few nice-looking sentences.

import { describe, expect, it } from 'vitest';

import { settingsConfig } from '../../utils/settings.config.js';
import {
    CLOCK_KEYS,
    contradictsDayPart,
    dayGreeting,
    dayPart,
    namesWrongTimeOfDay,
    roughTime,
    stationZone,
    timeClaimIn,
} from '../../../src/modules/director/clock.words.js';

/** An instant from a UTC wall clock, so a test can name the time it means. */
const at = (hour: number, minute: number, second = 0): number => Date.UTC(2026, 7, 13, hour, minute, second);

const UTC = 'UTC';

describe('roughTime', () => {
    it('says the hour that has just passed', () => {
        expect(roughTime(at(9, 1), UTC).words).toBe('just after nine');
        expect(roughTime(at(9, 6), UTC).words).toBe('just after nine');
    });

    it('looks forward to the quarter that has not arrived', () => {
        expect(roughTime(at(9, 8), UTC).words).toBe('coming up to quarter past nine');
        expect(roughTime(at(9, 25), UTC).words).toBe('coming up to half past nine');
    });

    it('names the hour ahead once it is counting down to it', () => {
        expect(roughTime(at(9, 40), UTC).words).toBe('coming up to quarter to ten');
        expect(roughTime(at(9, 47), UTC).words).toBe('just after quarter to ten');
        expect(roughTime(at(9, 55), UTC).words).toBe('coming up to ten');
    });

    it('reads midnight and midday as words rather than as twelve and zero', () => {
        expect(roughTime(at(0, 2), UTC).words).toBe('just after midnight');
        expect(roughTime(at(12, 2), UTC).words).toBe('just after midday');
        // The wrap in both directions: the hour before each of them counts down to it.
        expect(roughTime(at(23, 55), UTC).words).toBe('coming up to midnight');
        expect(roughTime(at(11, 55), UTC).words).toBe('coming up to midday');
    });

    it('uses the twelve-hour clock, so the evening reads like the morning', () => {
        expect(roughTime(at(21, 1), UTC).words).toBe('just after nine');
        expect(roughTime(at(13, 31), UTC).words).toBe('just after half past one');
    });

    it('answers a window that contains the instant it describes, at every minute of the day', () => {
        for (let hour = 0; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute++) {
                const instant = at(hour, minute, 30);
                const { words, validFrom, validUntil } = roughTime(instant, UTC);

                expect(validFrom, words).toBeLessThanOrEqual(instant);
                expect(validUntil, words).toBeGreaterThan(instant);
            }
        }
    });

    it('gives every phrasing a window long enough to outlive the projection drift', () => {
        // A minute of drift is the realistic worst case: records carry exact durations and only the
        // unmeasured segments between them are guessed. A phrasing valid for less than that would
        // expire between being written and being handed over.
        for (let minute = 0; minute < 60; minute++) {
            const { words, validFrom, validUntil } = roughTime(at(9, minute), UTC);
            expect(validUntil - validFrom, words).toBeGreaterThanOrEqual(5 * 60_000);
        }
    });

    it('starts each window on a whole minute of the hour it belongs to', () => {
        const { validFrom, validUntil } = roughTime(at(9, 3, 42), UTC);

        expect(validFrom).toBe(at(9, 0));
        expect(validUntil).toBe(at(9, 7));
    });

    it('reads the clock where the station is, not where the server is', () => {
        // One instant, two zones, two different hours. This is the whole reason the zone is a
        // setting: the same moment is "just after nine" in London and "just after four" in New York.
        const instant = Date.UTC(2026, 7, 13, 20, 2);

        expect(roughTime(instant, 'Europe/London').words).toBe('just after nine');
        expect(roughTime(instant, 'America/New_York').words).toBe('just after four');
    });

    it('keeps the window aligned to the station hour in a zone offset by part of an hour', () => {
        // India is UTC+05:30, so the station's hour starts halfway through UTC's. A window computed
        // off the UTC clock would be thirty minutes out and every phrasing would expire early.
        const instant = Date.UTC(2026, 7, 13, 3, 33); // 09:03 where the station is
        const { words, validFrom, validUntil } = roughTime(instant, 'Asia/Kolkata');

        expect(words).toBe('just after nine');
        // The station's hour starts at :30 past UTC's, and the window has to start with it.
        expect(validFrom).toBe(Date.UTC(2026, 7, 13, 3, 30));
        expect(validUntil).toBe(Date.UTC(2026, 7, 13, 3, 37));
    });
});

// Same invariant as above, coarser: the words a greeting uses have to hold for the whole window
// stamped with them, or a break written at ten to twelve and spoken at five past says good morning
// in the afternoon.
describe('dayGreeting', () => {
    it('greets the part of the day it is in', () => {
        expect(dayGreeting(at(6, 0), UTC)?.words).toBe('good morning');
        expect(dayGreeting(at(11, 59), UTC)?.words).toBe('good morning');
        expect(dayGreeting(at(12, 0), UTC)?.words).toBe('good afternoon');
        expect(dayGreeting(at(17, 59), UTC)?.words).toBe('good afternoon');
        expect(dayGreeting(at(18, 0), UTC)?.words).toBe('good evening');
    });

    it('says nothing at all in the small hours', () => {
        // Deliberate: "good night" to somebody who has just tuned in is a goodbye, and a welcome can
        // simply leave the greeting out.
        expect(dayGreeting(at(2, 0), UTC)).toBeUndefined();
        expect(dayGreeting(at(22, 0), UTC)).toBeUndefined();
        expect(dayGreeting(at(4, 59), UTC)).toBeUndefined();
    });

    it('carries a window that contains the moment it describes, all day', () => {
        for (let hour = 0; hour < 24; hour++) {
            for (const minute of [0, 17, 43, 59]) {
                const instant = at(hour, minute);
                const greeting = dayGreeting(instant, UTC);
                if (greeting === undefined) continue;

                expect(greeting.validFrom).toBeLessThanOrEqual(instant);
                expect(greeting.validUntil).toBeGreaterThan(instant);
                // And the window really is the daypart's, so a break stamped with it is dropped at
                // the boundary rather than a fixed span after it was written.
                expect(dayGreeting(greeting.validFrom, UTC)?.words).toBe(greeting.words);
                expect(dayGreeting(greeting.validUntil, UTC)?.words).not.toBe(greeting.words);
            }
        }
    });

    it("is the station's own part of the day, not the host's", () => {
        // Half past nine in the morning in Kolkata is four in the morning in UTC, which greets
        // nobody.
        const instant = Date.UTC(2026, 7, 13, 4, 0);

        expect(dayGreeting(instant, 'Asia/Kolkata')?.words).toBe('good morning');
        expect(dayGreeting(instant, UTC)).toBeUndefined();
    });
});

describe('stationZone', () => {
    it('answers what the operator set', () => {
        const { config } = settingsConfig({ [CLOCK_KEYS.timezone]: 'Europe/London' });
        expect(stationZone(config)).toBe('Europe/London');
    });

    it('falls back to the host when nobody has said', () => {
        const { config } = settingsConfig();
        expect(stationZone(config)).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });

    it('treats a box of whitespace as nobody having said', () => {
        const { config } = settingsConfig({ [CLOCK_KEYS.timezone]: '   ' });
        expect(stationZone(config)).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });
});

// The failure this covers is one that was live on air rather than a hypothetical: `roughTime` is
// twelve-hour with no am or pm on purpose, so a model told only the hour said "tonight" over a
// breakfast show and was inside every rule it had been given. `dayPart` is the half of the day it
// was missing, and the property that matters is that it covers ALL of it — the greeting deliberately
// has a hole in the small hours, which is exactly the stretch a presenter says "tonight" about.
describe('dayPart', () => {
    it('names every hour of the clock, including the ones no greeting covers', () => {
        for (let hour = 0; hour < 24; hour++) {
            const part = dayPart(at(hour, 30), UTC);

            expect(part.words.length).toBeGreaterThan(0);
            expect(part.validFrom).toBeLessThanOrEqual(at(hour, 30));
            expect(part.validUntil).toBeGreaterThan(at(hour, 30));
        }
    });

    it('calls the small hours tonight, where a greeting says nothing at all', () => {
        expect(dayGreeting(at(2, 0), UTC)).toBeUndefined();
        expect(dayPart(at(2, 0), UTC).words).toBe('tonight');
    });

    it('reads the morning as the morning, which is the break that went out wrong', () => {
        // 07:07 local: `roughTime` says "coming up to quarter past seven" and means the morning one.
        expect(dayPart(at(7, 7), UTC).words).toBe('this morning');
        expect(dayPart(at(14, 0), UTC).words).toBe('this afternoon');
        expect(dayPart(at(20, 0), UTC).words).toBe('this evening');
        expect(dayPart(at(23, 0), UTC).words).toBe('tonight');
    });

    it("is the station's own part of the day, not the host's", () => {
        // Half past nine in the morning in Kolkata is four in the morning in UTC.
        const instant = Date.UTC(2026, 7, 13, 4, 0);

        expect(dayPart(instant, 'Asia/Kolkata').words).toBe('this morning');
        expect(dayPart(instant, UTC).words).toBe('tonight');
    });
});

// Telling the model is necessary and is measurably not sufficient. Of the nine scripts this station
// wrote that named a daypart having been told one, six named a different one — and every one of the
// six had reached for "tonight". Three of those six were told "this evening", which is a presenter's
// own choice of words rather than a mistake; the other three were told the morning or the afternoon,
// which is the thing a listener hears and the station cannot take back. So evening and tonight are
// one answer and nothing else is.
describe('contradictsDayPart', () => {
    const morning = dayPart(at(9, 30), UTC);
    const afternoon = dayPart(at(14, 0), UTC);
    const evening = dayPart(at(20, 0), UTC);

    it('asks nothing of a script that named no part of the day at all', () => {
        expect(contradictsDayPart('That one still holds up. Here is another.', morning)).toBeUndefined();
    });

    it('asks nothing when the break was never told what time it was', () => {
        // Which was every ordinary talk break until the planner started stamping `airsAt`. A script
        // cannot be refused for contradicting something nobody said to it.
        expect(contradictsDayPart('Great record for tonight.', undefined)).toBeUndefined();
    });

    it('permits the words it was given', () => {
        expect(contradictsDayPart('Lovely way to spend this morning.', morning)).toBeUndefined();
    });

    it('permits an evening called tonight, because a presenter at eight may say either', () => {
        expect(contradictsDayPart('Big one for tonight.', evening)).toBeUndefined();
    });

    it('refuses an afternoon called tonight, which is the break that went out wrong', () => {
        expect(contradictsDayPart('Big one for tonight.', afternoon)).toBe('tonight');
    });

    it('refuses a morning called tonight however it was capitalised', () => {
        // A model capitalises the first word of a sentence, and a check that missed it would pass
        // exactly the scripts most likely to be wrong — the ones that OPEN on the word.
        expect(contradictsDayPart('Tonight we are back to back.', morning)).toBe('tonight');
    });

    it('refuses a morning called the afternoon, which is the same crossing the other way', () => {
        expect(contradictsDayPart('Settling into this afternoon nicely.', morning)).toBe('this afternoon');
    });

    // What the table's phrasing could not see. The bulletin that aired opened "Breaking the morning
    // air" at 17:33 with `airs_at` set, so this is not the never-told bargain: `saysTime` is
    // `includes`, the table carries "this morning", and no search for the one finds the other.
    describe('on a daypart the script named without the table’s determiner', () => {
        it('refuses the afternoon called the morning, which is the bulletin that went out', () => {
            expect(contradictsDayPart('Breaking the morning air on Deadair with new information.', afternoon)).toBe('the morning');
        });

        it('refuses a morning greeted as the evening', () => {
            expect(contradictsDayPart('Good evening, my friends.', morning)).toBe('good evening');
        });

        it('answers the words the script used, not the table’s, so an operator reads what was written', () => {
            // The row says `it said "the morning"`, which is the phrase to go and look for. The
            // table's "this morning" would send them hunting for something the model never wrote.
            expect(contradictsDayPart('That morning feeling, on Deadair.', afternoon)).toBe('that morning');
        });

        it('still permits the stretch it was told, however the script phrased it', () => {
            expect(contradictsDayPart('The morning air, on Deadair.', morning)).toBeUndefined();
        });

        it('asks nothing of a daypart noun with no determiner in front of it', () => {
            // A passing mention rather than a claim about now: the break is not telling anybody what
            // time it is, and refusing it would cost a good sentence for a word it did not mean.
            expect(contradictsDayPart('They recorded the whole thing in one morning.', afternoon)).toBeUndefined();
        });

        it('leaves tonight matching bare, which is the word with no determiner to take', () => {
            expect(contradictsDayPart('Tonight we are back to back.', morning)).toBe('tonight');
        });
    });
});

describe('timeClaimIn', () => {
    const morning = dayPart(at(9, 30), UTC);
    const halfPast = roughTime(at(9, 30), UTC);

    it('makes no claim for a script that mentioned no time', () => {
        expect(timeClaimIn('That one still holds up.', halfPast, morning)).toBeUndefined();
    });

    it('holds a script to the words it actually used', () => {
        expect(timeClaimIn('It is this morning and we are still here.', halfPast, morning)).toEqual({
            from: morning.validFrom,
            until: morning.validUntil,
        });
    });

    // The interesting case: two claims with different lifetimes, where the narrow one has to win or
    // a break saying the hour outlives the hour it named.
    it('takes the narrower window when a script made both claims', () => {
        expect(timeClaimIn(`It is ${halfPast.words}, this morning, on Deadair.`, halfPast, morning)).toEqual({
            from: halfPast.validFrom,
            until: halfPast.validUntil,
        });
    });

    it('ignores an offer the moment never had', () => {
        expect(timeClaimIn('It is this morning.', undefined, morning)?.until).toBe(morning.validUntil);
    });
});

// The gap `contradictsDayPart` structurally cannot cover. A stretch says which half of the day a
// phrasing names, and some words name a POINT in it — so "midday" and half past four in the
// afternoon are the same stretch, and the check that catches every other wrong daypart passes this
// one. It aired: a bulletin opened "welcome to your midday news blast" at 16:30.
describe('namesWrongTimeOfDay', () => {
    it('refuses a break that calls half past four midday', () => {
        expect(namesWrongTimeOfDay('Welcome to your midday news blast.', at(16, 30), UTC)).toBe('midday');
    });

    it('allows the same words when it really is the middle of the day', () => {
        // The case a stretch of its own would have got wrong, which is why the window exists.
        expect(namesWrongTimeOfDay('Welcome to your midday news blast.', at(12, 15), UTC)).toBeUndefined();
        expect(namesWrongTimeOfDay('Coming up to midday.', at(11, 50), UTC)).toBeUndefined();
    });

    it('does not find noon inside afternoon', () => {
        // The substring trap, and the reason `saysTime` could not be reused: the station's own
        // daypart phrasing would otherwise trip the guard that told the model to use it.
        expect(namesWrongTimeOfDay("You're with us this afternoon on Deadair.", at(16, 30), UTC)).toBeUndefined();
    });

    it('reads a window that wraps around the turn of the day', () => {
        expect(namesWrongTimeOfDay('Nearly midnight here.', at(23, 30), UTC)).toBeUndefined();
        expect(namesWrongTimeOfDay('Nearly midnight here.', at(0, 30), UTC)).toBeUndefined();
        expect(namesWrongTimeOfDay('Nearly midnight here.', at(14, 0), UTC)).toBe('midnight');
    });

    it('asks nothing of a break that was never told when it airs', () => {
        // `contradictsDayPart`'s own bargain: the prompt has to have said so before a script can be
        // refused for contradicting it.
        expect(namesWrongTimeOfDay('Welcome to your midday news blast.', undefined, UTC)).toBeUndefined();
        expect(namesWrongTimeOfDay('Welcome to your midday news blast.', at(16, 30), undefined)).toBeUndefined();
    });

    it('reads the station zone rather than the hosts', () => {
        // 16:30 UTC is half past eleven in New York, which is the middle of the day there.
        expect(namesWrongTimeOfDay('Your midday news.', at(16, 30), 'America/New_York')).toBeUndefined();
        expect(namesWrongTimeOfDay('Your midday news.', at(16, 30), 'Europe/London')).toBe('midday');
    });

    it('says nothing about a script that named no time of day at all', () => {
        expect(namesWrongTimeOfDay('That was Blue Monday, from New Order.', at(16, 30), UTC)).toBeUndefined();
    });
});
