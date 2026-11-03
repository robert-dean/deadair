import type { TFunction } from 'i18next';
import type { Occasion, OccasionInput, SpecialRecurrence } from '@deadair/sdk';

import { monthLong, weekdayLong } from '../../i18n/format.locale';
import type { Mood } from '../programme/programme.fields';

/** What the occasion form holds. Every kind's fields at once, so switching kind back loses nothing typed. */
export interface OccasionDraft {
    words: string;
    ruleKind: Occasion['ruleKind'];
    month: number;
    day: number;
    ordinal: number;
    weekday: number;
    offsetDays: number;
    calendar: NonNullable<Occasion['calendar']>;
    calendarMonth: string;
    /** One date per line or comma-separated, as somebody pastes them. */
    dates: string;
    mood: Mood | undefined;
    enabled: boolean;
}

export const BLANK_OCCASION: OccasionDraft = {
    words: '',
    ruleKind: 'fixed',
    month: 1,
    day: 1,
    ordinal: 1,
    weekday: 6,
    offsetDays: 0,
    calendar: 'hebrew',
    calendarMonth: '',
    dates: '',
    mood: undefined,
    enabled: true,
};

/** A saved occasion as the form holds it, with the other kinds' fields left at their blanks. */
export function draftOfOccasion(occasion: Occasion): OccasionDraft {
    return {
        ...BLANK_OCCASION,
        words: occasion.words,
        ruleKind: occasion.ruleKind,
        ...(occasion.month === undefined ? {} : { month: occasion.month }),
        ...(occasion.day === undefined ? {} : { day: occasion.day }),
        ...(occasion.ordinal === undefined ? {} : { ordinal: occasion.ordinal }),
        ...(occasion.weekday === undefined ? {} : { weekday: occasion.weekday }),
        ...(occasion.offsetDays === undefined ? {} : { offsetDays: occasion.offsetDays }),
        ...(occasion.calendar === undefined ? {} : { calendar: occasion.calendar }),
        ...(occasion.calendarMonth === undefined ? {} : { calendarMonth: occasion.calendarMonth }),
        dates: (occasion.dates ?? []).join('\n'),
        mood: occasion.mood,
        enabled: occasion.enabled,
    };
}

/** What the form sends: its words and only the fields its kind reads. */
export function inputOfDraft(draft: OccasionDraft): OccasionInput {
    const shared = {
        words: draft.words.trim(),
        enabled: draft.enabled,
        ...(draft.mood === undefined ? {} : { mood: draft.mood }),
    };
    switch (draft.ruleKind) {
        case 'fixed':
            return { ...shared, ruleKind: 'fixed', month: draft.month, day: draft.day };
        case 'weekday':
            return { ...shared, ruleKind: 'weekday', month: draft.month, ordinal: draft.ordinal, weekday: draft.weekday };
        case 'easter':
            return { ...shared, ruleKind: 'easter', offsetDays: draft.offsetDays };
        case 'calendar':
            return { ...shared, ruleKind: 'calendar', calendar: draft.calendar, calendarMonth: draft.calendarMonth, day: draft.day };
        case 'dates':
            return { ...shared, ruleKind: 'dates', dates: datesIn(draft.dates) };
    }
}

/** The dates in what was pasted, in whatever it separated them with. The API says which is not a date. */
export function datesIn(text: string): string[] {
    return text.split(/[\s,]+/).filter(date => date !== '');
}

/** A saved occasion as a write sends it: the same occasion, with what only the station can say taken out. */
export function inputOfOccasion(occasion: Occasion): OccasionInput {
    const { id: _id, position: _position, nextDate: _nextDate, ...input } = occasion;
    return input;
}

/** When an occasion or a special on a rule falls, in a sentence an operator can check at a glance. */
export function describeRule(rule: SpecialRecurrence, t: TFunction<'schedule'>): string {
    const { month, day, ordinal, weekday, offsetDays, calendar, calendarMonth, dates } = rule;
    switch (rule.ruleKind) {
        case 'fixed':
            return t('occasions.rule.fixed', { month: monthLong(month ?? 1), day: day ?? 1 });
        case 'weekday':
            return t('occasions.rule.weekday', {
                which: t(`occasions.ordinals.${ordinalKey(ordinal ?? 1)}`),
                weekday: weekdayLong(weekday ?? 0),
                month: monthLong(month ?? 1),
            });
        case 'easter':
            if ((offsetDays ?? 0) === 0) return t('occasions.rule.easter');
            return (offsetDays ?? 0) < 0
                ? t('occasions.rule.beforeEaster', { count: -(offsetDays ?? 0) })
                : t('occasions.rule.afterEaster', { count: offsetDays ?? 0 });
        case 'calendar':
            return t('occasions.rule.calendar', {
                day: day ?? 1,
                month: calendarMonth ?? '',
                calendar: t(`occasions.calendars.${calendar ?? 'hebrew'}`),
            });
        case 'dates':
            return t('occasions.rule.dates', { count: dates?.length ?? 0 });
    }
}

/** The catalog's key for which of a weekday in a month: `-1` is `last`. */
function ordinalKey(ordinal: number): OrdinalKey {
    return ordinal === -1 ? 'last' : (`n${ordinal}` as OrdinalKey);
}

type OrdinalKey = 'n1' | 'n2' | 'n3' | 'n4' | 'n5' | 'last';

/** The ids in their new order, with one moved a place, or `undefined` when it is already at that end. */
export function movedOccasion(ids: readonly string[], id: string, by: -1 | 1): string[] | undefined {
    const from = ids.indexOf(id);
    const to = from + by;
    if (from === -1 || to < 0 || to >= ids.length) return undefined;

    const moved = [...ids];
    moved.splice(from, 1);
    moved.splice(to, 0, id);
    return moved;
}
