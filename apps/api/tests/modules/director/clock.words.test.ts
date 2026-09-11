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
    namesWrongSky,
    namesWrongTimeOfDay,
    roughTime,
    saysTime,
    stationZone,
    timeClaimIn,
} from '../../../src/modules/director/clock.words.js';

/** An instant from a UTC wall clock, so a test can name the time it means. */
const at = (hour: number, minute: number, second = 0): number => Date.UTC(2026, 7, 13, hour, minute, second);

const UTC = 'UTC';

// Every band now has more than one true-for-the-whole-window wording (see `clock.words.ts` §
// `PHRASINGS`), so a test can no longer pin an instant to a single literal string: which of a
// band's wordings comes back depends on the hour, by design. These tables name the band's whole
// vocabulary, so a test can assert "one of these" and, separately, that the pick is stable inside
// an hour and rotates across hours.
const AT_HOUR = (hour: string): string[] => [`just after ${hour}`, `a little after ${hour}`, `not long after ${hour}`];
const TO_QUARTER_PAST = (hour: string): string[] => [`coming up to quarter past ${hour}`, `getting on for quarter past ${hour}`];
const AFTER_QUARTER_PAST = (hour: string): string[] => [`just after quarter past ${hour}`, `a little after quarter past ${hour}`];
const TO_HALF_PAST = (hour: string): string[] => [`coming up to half past ${hour}`, `getting on for half past ${hour}`];
const AFTER_HALF_PAST = (hour: string): string[] => [`just after half past ${hour}`, `a little after half past ${hour}`];
const TO_QUARTER_TO = (next: string): string[] => [`coming up to quarter to ${next}`, `getting on for quarter to ${next}`];
const AFTER_QUARTER_TO = (next: string): string[] => [`just after quarter to ${next}`, `a little after quarter to ${next}`];
const TO_HOUR = (next: string): string[] => [`coming up to ${next}`, `getting on for ${next}`];

describe('roughTime', () => {
    it('says the hour that has just passed', () => {
        const words = roughTime(at(9, 1), UTC).words;
        expect(AT_HOUR('nine')).toContain(words);
        // Stable inside the hour: minute 1 and minute 6 fall in the same band and the same hour, so
        // the rewrite path re-deriving these words from either instant has to agree.
        expect(roughTime(at(9, 6), UTC).words).toBe(words);
    });

    it('looks forward to the quarter that has not arrived', () => {
        expect(TO_QUARTER_PAST('nine')).toContain(roughTime(at(9, 8), UTC).words);
        expect(TO_HALF_PAST('nine')).toContain(roughTime(at(9, 25), UTC).words);
    });

    it('says the quarter that has just passed', () => {
        expect(AFTER_QUARTER_PAST('nine')).toContain(roughTime(at(9, 16), UTC).words);
        expect(AFTER_HALF_PAST('nine')).toContain(roughTime(at(9, 31), UTC).words);
    });

    it('names the hour ahead once it is counting down to it', () => {
        expect(TO_QUARTER_TO('ten')).toContain(roughTime(at(9, 40), UTC).words);
        expect(AFTER_QUARTER_TO('ten')).toContain(roughTime(at(9, 47), UTC).words);
        expect(TO_HOUR('ten')).toContain(roughTime(at(9, 55), UTC).words);
    });

    it('reads midnight and midday as words rather than as twelve and zero', () => {
        expect(AT_HOUR('midnight')).toContain(roughTime(at(0, 2), UTC).words);
        expect(AT_HOUR('midday')).toContain(roughTime(at(12, 2), UTC).words);
        // The wrap in both directions: the hour before each of them counts down to it.
        expect(TO_HOUR('midnight')).toContain(roughTime(at(23, 55), UTC).words);
        expect(TO_HOUR('midday')).toContain(roughTime(at(11, 55), UTC).words);
    });

    it('uses the twelve-hour clock, so the evening reads like the morning', () => {
        expect(AT_HOUR('nine')).toContain(roughTime(at(21, 1), UTC).words);
        expect(AFTER_HALF_PAST('one')).toContain(roughTime(at(13, 31), UTC).words);
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

        expect(AT_HOUR('nine')).toContain(roughTime(instant, 'Europe/London').words);
        expect(AT_HOUR('four')).toContain(roughTime(instant, 'America/New_York').words);
    });

    it('keeps the window aligned to the station hour in a zone offset by part of an hour', () => {
        // India is UTC+05:30, so the station's hour starts halfway through UTC's. A window computed
        // off the UTC clock would be thirty minutes out and every phrasing would expire early.
        const instant = Date.UTC(2026, 7, 13, 3, 33); // 09:03 where the station is
        const { words, validFrom, validUntil } = roughTime(instant, 'Asia/Kolkata');

        expect(AT_HOUR('nine')).toContain(words);
        // The station's hour starts at :30 past UTC's, and the window has to start with it.
        expect(validFrom).toBe(Date.UTC(2026, 7, 13, 3, 30));
        expect(validUntil).toBe(Date.UTC(2026, 7, 13, 3, 37));
    });

    // The rotation itself: a band with more than one wording must not always answer the same one,
    // or the whole point of having several is lost, and it must answer the SAME one for two asks at
    // the same hour, or the rewrite path (which re-derives these words independently) could disagree
    // with what a segment already claims.
    describe('rotation across the wordings', () => {
        it('is stable inside one hour, at any minute in the band', () => {
            const first = roughTime(at(9, 1), UTC).words;
            for (const minute of [1, 2, 3, 4, 5, 6]) {
                expect(roughTime(at(9, minute), UTC).words).toBe(first);
            }
        });

        it('picks a different wording for the same band an hour later, when the band has more than one', () => {
            // Adjacent hour indices always land on adjacent (wrapping) positions in a band's wording
            // list, so for a band with more than one wording the pick can never repeat hour to hour.
            const thisHour = roughTime(at(9, 1), UTC).words;
            const nextHour = roughTime(at(10, 1), UTC).words;

            expect(AT_HOUR('nine')).toContain(thisHour);
            expect(AT_HOUR('ten')).toContain(nextHour);
            expect(nextHour).not.toBe(thisHour);
        });

        it('produces every wording of every band over enough hours, each one true for its window', () => {
            // One representative minute per band, walked over two full days so every band's wording
            // list (the longest has three entries) is guaranteed to cycle at least once.
            const representativeMinutes = [1, 8, 16, 23, 31, 38, 46, 53];

            for (const minute of representativeMinutes) {
                const seen = new Set<string>();

                for (let hoursFromEpoch = 0; hoursFromEpoch < 48; hoursFromEpoch++) {
                    const instant = Date.UTC(2026, 7, 13, 0, minute, 30) + hoursFromEpoch * 3_600_000;
                    const time = roughTime(instant, UTC);

                    // True for its own window: the words this instant produced are what a script
                    // claiming them right now would be believed for.
                    expect(saysTime(`It's ${time.words}, on Deadair.`, time)).toBe(true);
                    expect(time.validFrom).toBeLessThanOrEqual(instant);
                    expect(time.validUntil).toBeGreaterThan(instant);

                    seen.add(time.words);
                }

                // Every band here has at least two wordings, so 48 hours must have shown more than one.
                expect(seen.size).toBeGreaterThanOrEqual(2);
            }
        });
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

// The time said with no word for it. A `conspiracy` audition at 15:48 in New York passed "Night
// falls, my listeners" and "Sunrise bleeds, my listeners" in the same run that refused "tonight"
// twice, because neither of the checks above reads what the sky is doing.
describe('namesWrongSky', () => {
    const NEW_YORK = 'America/New_York';
    /** The audition's own instant: 15:48 on 2026-09-11, New York. */
    const AUDITION = Date.parse('2026-09-11T15:48:00-04:00');

    describe('refuses the sky stated as now, at the wrong time', () => {
        it('refuses night falling at a quarter to four, which is the break that passed', () => {
            expect(namesWrongSky('Night falls, my listeners—Bush’s “Glycerine” rolls in.', AUDITION, NEW_YORK)).toBe('night falls');
        });

        it('refuses a sunrise at a quarter to four, which passed beside it', () => {
            expect(namesWrongSky('Sunrise bleeds, my listeners—dust swirling, a quiet storm.', AUDITION, NEW_YORK)).toBe('sunrise bleeds');
        });

        // From the live station's written scripts. The verb is never the same twice, which is why
        // an opener takes any present tense rather than a list of them.
        it('refuses the openers the station has already aired in the daytime', () => {
            expect(namesWrongSky('Night settles over Deadair, and my listeners, I bring you the final chord.', at(9, 0), UTC)).toBe('night settles');
            expect(namesWrongSky('Sunrise cracks over the horizon just as we glide from Boston.', at(11, 0), UTC)).toBe('sunrise cracks');
            expect(namesWrongSky('Staying up feels like a second pulse. Night stretches.', at(10, 0), UTC)).toBe('night stretches');
        });

        it('refuses the same claims made in the middle of a sentence', () => {
            expect(namesWrongSky('And as the night falls on Deadair, here is Slayer.', at(14, 0), UTC)).toBe('the night falls');
            expect(namesWrongSky('It rolls out over this night, my friends.', at(14, 0), UTC)).toBe('this night');
            expect(namesWrongSky('The sun’s coming up, my friends, and here is Boston.', at(14, 0), UTC)).toBe("the sun's coming up");
            expect(namesWrongSky('Dawn is breaking over the transmitter.', at(14, 0), UTC)).toBe('dawn is breaking');
        });
    });

    describe('takes the same words when they are true', () => {
        it('takes night falling in the evening and late at night', () => {
            expect(namesWrongSky('Night falls, my listeners.', at(20, 0), UTC)).toBeUndefined();
            expect(namesWrongSky('Night falls, my listeners.', at(2, 0), UTC)).toBeUndefined();
        });

        it('takes a sunrise in the early morning', () => {
            expect(namesWrongSky('Sunrise bleeds, my listeners.', at(6, 30), UTC)).toBeUndefined();
        });

        // Night is judged by the daypart and not by an hour of its own, so it refuses exactly where
        // "tonight" is refused and nowhere else. Two lines between afternoon and evening would be two
        // answers to one question.
        it('draws the night line where the daypart table draws it', () => {
            expect(namesWrongSky('Night falls, my listeners.', at(17, 59), UTC)).toBe('night falls');
            expect(namesWrongSky('Night falls, my listeners.', at(18, 0), UTC)).toBeUndefined();
        });

        it('reads the station zone rather than the hosts', () => {
            // 19:48 UTC is a quarter to four in New York and a quarter to nine in London.
            expect(namesWrongSky('Night falls, my listeners.', AUDITION, 'Europe/London')).toBeUndefined();
        });
    });

    // The host's whole story is a night, told in the past with a determiner in front of it. Refusing
    // that would refuse the character for the thing he is.
    describe('asks nothing of a night that is not now', () => {
        it('takes the story told in the past tense', () => {
            for (const script of [
                'That night they took me, and the lawn never grew back.',
                'The night was black, the streetlights blinked, and then the light.',
                'Night fell over the wheat field in nineteen ninety-seven.',
                'The night of the abduction still lingers in me.',
                'The night aliens took me, my watch stopped.',
            ]) {
                expect(namesWrongSky(script, AUDITION, NEW_YORK), script).toBeUndefined();
            }
        });

        it('takes a present tense about later or about a habit', () => {
            expect(namesWrongSky('It stutters on the airwaves long after the night falls.', AUDITION, NEW_YORK)).toBeUndefined();
            expect(namesWrongSky('Beats that will have you humming till night falls.', AUDITION, NEW_YORK)).toBeUndefined();
            expect(namesWrongSky('Stay with me until the sun is coming up.', AUDITION, NEW_YORK)).toBeUndefined();
        });

        // Each of these was in the same audition, or in the station's own daytime scripts, and each
        // is a picture or a mood rather than a clock. See `namesWrongSky` for why each was left out.
        it('takes imagery that says nothing about the hour', () => {
            for (const script of [
                'The sound lingers like ash under moonlight.',
                'Shiver in the dark, my listeners—Angel Of Death blares out.',
                'Whispers crackle, my listeners, the moon drifts over a black-sided sky.',
                'A station that keeps the night alive.',
                'It will keep you dancing all night long!',
                'That chorus hits like a sunrise on a skateboard ramp.',
                'Those riffs remind me of the sun rising over the Autobahn.',
                'Bark at the Moon just hit the airwaves.',
            ]) {
                expect(namesWrongSky(script, AUDITION, NEW_YORK), script).toBeUndefined();
            }
        });
    });

    // The trade, pinned so it stays a decision. A story told in the historic present reads exactly
    // like a claim within its own sentence, and it goes to the floor. One sentence lost, against a
    // listener told at a quarter to four that night is falling.
    it('refuses a story told in the historic present, which is the price', () => {
        expect(namesWrongSky('Nineteen ninety-seven. Night falls. Then the lights.', AUDITION, NEW_YORK)).toBe('night falls');
    });

    it('asks nothing of a break that was never told when it airs', () => {
        expect(namesWrongSky('Night falls, my listeners.', undefined, NEW_YORK)).toBeUndefined();
        expect(namesWrongSky('Night falls, my listeners.', AUDITION, undefined)).toBeUndefined();
    });
});
