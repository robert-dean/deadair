import type { AlmanacEntry, AlmanacEntryKind, AlmanacSubject } from '@deadair/plugin-sdk';

import type { OnThisDayItem, OnThisDayPage, OnThisDayResponse } from './wikipedia.types.js';

/**
 * Turning Wikipedia's "on this day" feed into almanac entries, with every
 * judgement in one pure file and out of the request path.
 *
 * Pure for `wikipedia.resolve.ts`'s reason, which matters more here: an entry
 * that comes out of this mangled does not fail anything, it is read out on air
 * in the voice the station uses for the things it is sure about.
 *
 * ## The feed is REST and the rest of this plugin is the action API
 *
 * Two APIs on one host, which is why {@link feedUrl} builds an address rather
 * than going through `MediaWikiClient`'s parameters. They share the manifest's
 * network entry, its bucket and its contact header, because they are one
 * service and a published rate limit covers a service rather than a hostname.
 *
 * ## Which endpoints get fetched
 *
 * `all` in one request when the caller wants everything, and the narrow
 * endpoints when it does not — the whole day is 1.4 MB and the events alone are
 * 260 kB, measured 2026-09-20, because every entry carries the full summary of
 * every article it mentions and this keeps three fields of it. A station that
 * reads only anniversaries should not pay for two hundred birthdays.
 *
 * Asking for events fetches `selected` beside `events`, which is the one place
 * this spends a second request deliberately: `selected` is the handful Wikipedia
 * puts on its own front page, it is a subset of `events` rather than a separate
 * list, and {@link AlmanacEntry.notable} is what a thin day falls back on.
 */

/** One of the feed's own endpoints. `all` is every list in one response. */
export type FeedType = 'all' | 'selected' | 'events' | 'births' | 'deaths' | 'holidays';

/** Which list in the response an entry kind comes out of. `event` has two, and `selected` is the smaller. */
const LIST_FOR_KIND: Record<AlmanacEntryKind, FeedType[]> = {
    event: ['selected', 'events'],
    birth: ['births'],
    death: ['deaths'],
    observance: ['holidays'],
};

/** What each list of the response means, which is the same mapping read the other way. */
const KIND_FOR_LIST: Record<Exclude<FeedType, 'all'>, AlmanacEntryKind> = {
    selected: 'event',
    events: 'event',
    births: 'birth',
    deaths: 'death',
    holidays: 'observance',
};

/**
 * The endpoints to fetch for what was asked.
 *
 * `all` whenever the caller wants three or more of the four kinds, because at
 * that point the single request is smaller than the requests it replaces and
 * far kinder to a shared rate bucket. Sorted so a cache key built from this is
 * stable.
 */
export function feedTypesFor(kinds?: readonly AlmanacEntryKind[]): FeedType[] {
    const wanted = kinds === undefined || kinds.length === 0 ? (Object.keys(LIST_FOR_KIND) as AlmanacEntryKind[]) : [...new Set(kinds)];
    if (wanted.length >= 3) return ['all'];

    return [...new Set(wanted.flatMap(kind => LIST_FOR_KIND[kind] ?? []))].sort();
}

/** Where a feed type for a date is read, in one language edition. */
export const feedUrl = (language: string, type: FeedType, month: number, day: number): string =>
    `https://${language}.wikipedia.org/api/rest_v1/feed/onthisday/${type}/${pad(month)}/${pad(day)}`;

/** `MM-DD`, which is {@link AlmanacDay.date} and half of a cache key. */
export const almanacDate = (month: number, day: number): string => `${pad(month)}-${pad(day)}`;

/**
 * A date the feed can be asked for, or `undefined`.
 *
 * Checked rather than clamped: a caller that passed month 13 has a bug, and
 * asking about December instead would hide it behind a day of history that
 * looks perfectly reasonable. February the 30th passes, deliberately — the feed
 * answers for every day a calendar has ever had and the 29th is the case that
 * matters, so the only thing worth refusing here is a number that is not a date
 * at all.
 */
export function askableDate(month: unknown, day: unknown): { month: number; day: number } | undefined {
    const monthNumber = whole(month);
    const dayNumber = whole(day);
    if (monthNumber === undefined || dayNumber === undefined) return undefined;
    if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return undefined;

    return { month: monthNumber, day: dayNumber };
}

/**
 * Every entry in one response, whichever endpoint it came from.
 *
 * A response from `all` carries several lists and a narrow one carries the list
 * it is named after, so both are read the same way: walk whichever of the five
 * keys are present. An endpoint that answered with a shape nobody recognises
 * contributes nothing rather than throwing, which is the posture this file
 * keeps throughout — the station has other things to talk about.
 */
export function entriesIn(response: OnThisDayResponse | undefined): AlmanacEntry[] {
    if (response === null || typeof response !== 'object') return [];

    const entries: AlmanacEntry[] = [];

    for (const [list, kind] of Object.entries(KIND_FOR_LIST) as [Exclude<FeedType, 'all'>, AlmanacEntryKind][]) {
        const items = response[list];
        if (!Array.isArray(items)) continue;

        // `selected` is the front page's pick, and the narrow endpoint answers
        // under that key too. Marked from the LIST an entry arrived in rather
        // than from anything on the item, because the feed says so nowhere
        // else: an entry is notable by virtue of being in that list.
        for (const item of items) {
            const entry = entryOf(item, kind, list === 'selected');
            if (entry !== undefined) entries.push(entry);
        }
    }

    return entries;
}

/**
 * One item, or `undefined` for one with nothing sayable in it.
 *
 * The text is the only required part. An entry with no article behind it is
 * kept — the sentence is still sourced, to the day's own page — but an entry
 * with no sentence is nothing at all.
 */
function entryOf(item: OnThisDayItem | undefined, kind: AlmanacEntryKind, notable: boolean): AlmanacEntry | undefined {
    const text = spoken(item?.text);
    if (text === undefined) return undefined;

    const subjects = (item?.pages ?? []).map(subjectOf).filter((subject): subject is AlmanacSubject => subject !== undefined);
    const year = whole(item?.year);

    return {
        kind,
        ...(year === undefined ? {} : { year }),
        text,
        ...(subjects[0]?.url === undefined ? {} : { url: subjects[0].url }),
        ...(subjects.length === 0 ? {} : { subjects }),
        ...(notable ? { notable: true } : {}),
    };
}

/**
 * One article the entry mentions.
 *
 * `titles.normalized` rather than `title`, which is the underscored form, and
 * `description` passed on untouched — that one line is what a station leaning
 * toward its own subject matter reads, and this plugin has no business deciding
 * what counts as one.
 */
function subjectOf(page: OnThisDayPage | undefined): AlmanacSubject | undefined {
    const title = spoken(page?.titles?.normalized ?? page?.title?.replace(/_/g, ' '));
    if (title === undefined) return undefined;

    const description = spoken(page?.description);
    const url = page?.content_urls?.desktop?.page?.trim();

    return { title, ...(description === undefined ? {} : { description }), ...(url === undefined || url.length === 0 ? {} : { url }) };
}

/**
 * The same entry arriving twice, collapsed, with the notable one kept.
 *
 * `selected` is a subset of `events` and both are fetched together, so without
 * this a station that reads the day's best line reads it again ten minutes
 * later as an ordinary one. Matched on the year and the sentence, which is what
 * the two lists actually share — the ids they carry are article ids and an
 * entry has several.
 */
export function withoutDuplicates(entries: readonly AlmanacEntry[]): AlmanacEntry[] {
    const kept = new Map<string, AlmanacEntry>();

    for (const entry of entries) {
        const key = `${entry.kind}|${entry.year ?? ''}|${entry.text.toLowerCase()}`;
        const held = kept.get(key);
        if (held === undefined) kept.set(key, entry);
        else if (entry.notable === true && held.notable !== true) kept.set(key, entry);
    }

    return [...kept.values()];
}

/**
 * At most `limit` of each kind, in the order they arrived.
 *
 * Per kind rather than overall, which is {@link AlmanacQuery.limit}'s own rule:
 * an overall cap on a day with two hundred births is a cap on the births alone.
 * The notable ones are kept first inside a kind, because a limit tight enough to
 * bite is a caller that wants the best of the day rather than the start of it.
 */
export function cappedPerKind(entries: readonly AlmanacEntry[], limit?: number): AlmanacEntry[] {
    const cap = whole(limit);
    if (cap === undefined || cap < 1) return [...entries];

    const counts = new Map<AlmanacEntryKind, number>();
    const ordered = [...entries].sort((left, right) => Number(right.notable ?? false) - Number(left.notable ?? false));
    const kept = new Set<AlmanacEntry>();

    for (const entry of ordered) {
        const seen = counts.get(entry.kind) ?? 0;
        if (seen >= cap) continue;
        counts.set(entry.kind, seen + 1);
        kept.add(entry);
    }

    // Back into the feed's own order, which is by year within a kind. The sort
    // above is only about which ones survive the cap.
    return entries.filter(entry => kept.has(entry));
}

/** The kinds the caller asked for, when it asked for any. */
export const ofKinds = (entries: readonly AlmanacEntry[], kinds?: readonly AlmanacEntryKind[]): AlmanacEntry[] =>
    kinds === undefined || kinds.length === 0 ? [...entries] : entries.filter(entry => kinds.includes(entry.kind));

/**
 * One line of plain text, or `undefined` for nothing worth saying.
 *
 * Newlines are the case this exists for: a feast day arrives as
 * `Christian feast day:\nEustace (Western Christianity)`, and a line break in
 * the middle of a claim is a sentence a speech engine reads as two.
 */
function spoken(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.replace(/\s+/g, ' ').trim();
    return text.length === 0 ? undefined : text;
}

/** A whole number, or `undefined` for anything else. A year of `0` is not a year the feed publishes. */
function whole(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

const pad = (value: number): string => String(value).padStart(2, '0');
