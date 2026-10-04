// Never-play rules, evaluated. What is pinned is when a rule holds (a season across the year end, an
// hour window across midnight, a mode, a slot, an expiry) and that a record nobody tagged falls under
// nothing, because a missing tag is not evidence of the genre a rule was written for.

import { describe, expect, it } from 'vitest';

import {
    activeRules,
    blockedBy,
    compileRules,
    inSeason,
    ruleActive,
    type BlockRule,
    type RuleContext,
} from '../../../src/modules/director/block.rules.js';
import type { StationClock } from '../../../src/modules/director/clock.bands.js';

const clock = (month: number, day: number, hour = 12): StationClock => ({ year: 2026, month, day, hour, minute: 0, second: 0, weekday: 1 });
const context = (over: Partial<RuleContext> = {}): RuleContext => ({ clock: clock(10, 4), now: Date.parse('2026-10-04T12:00:00Z'), ...over });
const rule = (over: Partial<BlockRule> = {}): BlockRule => ({ id: 'r1', field: 'genre', value: 'Country', ...over });

describe('inSeason', () => {
    it('holds inside a season within one year, ends included', () => {
        expect(inSeason(clock(6, 1), '06-01', '08-31')).toBe(true);
        expect(inSeason(clock(8, 31), '06-01', '08-31')).toBe(true);
        expect(inSeason(clock(9, 1), '06-01', '08-31')).toBe(false);
    });

    it('wraps the year end when the season starts after it finishes', () => {
        expect(inSeason(clock(12, 20), '12-01', '01-06')).toBe(true);
        expect(inSeason(clock(1, 3), '12-01', '01-06')).toBe(true);
        expect(inSeason(clock(2, 1), '12-01', '01-06')).toBe(false);
    });

    it('holds all year for a season with a missing or unreadable end', () => {
        expect(inSeason(clock(2, 1), '12-01', undefined)).toBe(true);
        expect(inSeason(clock(2, 1), '13-01', '01-06')).toBe(true);
    });
});

describe('ruleActive', () => {
    it('holds for a window of hours, across midnight too', () => {
        expect(ruleActive(rule({ fromHour: 6, untilHour: 21 }), context({ clock: clock(10, 4, 20) }))).toBe(true);
        expect(ruleActive(rule({ fromHour: 6, untilHour: 21 }), context({ clock: clock(10, 4, 21) }))).toBe(false);
        expect(ruleActive(rule({ fromHour: 22, untilHour: 6 }), context({ clock: clock(10, 4, 2) }))).toBe(true);
        expect(ruleActive(rule({ fromHour: 22, untilHour: 6 }), context({ clock: clock(10, 4, 12) }))).toBe(false);
    });

    it('stops holding once it has expired', () => {
        expect(ruleActive(rule({ endsAt: '2026-10-04T13:00:00Z' }), context())).toBe(true);
        expect(ruleActive(rule({ endsAt: '2026-10-04T11:00:00Z' }), context())).toBe(false);
    });

    it('holds only in the modes and slots it names, and in every one when it names none', () => {
        expect(ruleActive(rule({ modes: ['rotation'] }), context({ mode: 'rotation' }))).toBe(true);
        expect(ruleActive(rule({ modes: ['rotation'] }), context({ mode: 'feature' }))).toBe(false);
        expect(ruleActive(rule({ slotIds: ['breakfast'] }), context({ slotId: 'drive' }))).toBe(false);
        expect(ruleActive(rule({ modes: [], slotIds: [] }), context())).toBe(true);
    });
});

describe('blockedBy', () => {
    const rules = compileRules([rule({ id: 'no-country', value: 'Country' }), rule({ id: 'no-live', field: 'tag', value: 'live' })]);

    it('names the rule a record falls under', () => {
        expect(blockedBy(rules, ['Country Pop'])?.id).toBe('no-country');
        expect(blockedBy(rules, ['Live'])?.id).toBe('no-live');
    });

    it('lets through a record that only looks like the genre, or that nobody tagged', () => {
        expect(blockedBy(rules, ['Alt-Country Rock and Roll'])?.id).toBe('no-country');
        expect(blockedBy(rules, ['Countrypolitan'])).toBeUndefined();
        expect(blockedBy(rules, ['live recordings'])).toBeUndefined();
        expect(blockedBy(rules, [])).toBeUndefined();
    });

    it('judges only the rules that hold now', () => {
        const seasonal = compileRules([rule({ id: 'no-christmas', value: 'Christmas', seasonFrom: '01-07', seasonTo: '11-24' })]);
        expect(blockedBy(activeRules(seasonal, context({ clock: clock(10, 4) })), ['Christmas'])?.id).toBe('no-christmas');
        expect(blockedBy(activeRules(seasonal, context({ clock: clock(12, 20) })), ['Christmas'])).toBeUndefined();
    });

    it('drops a rule that names no genre at all, rather than letting it match everything', () => {
        expect(compileRules([rule({ value: '!!!' })])).toEqual([]);
    });
});
