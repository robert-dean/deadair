// The judgement in the almanac half: which endpoints answer a query, and what a feed entry becomes.
// The request chain around it is covered in `wikipedia.plugin.test.ts`.

import { describe, expect, it } from 'vitest';

import { almanacDate, askableDate, cappedPerKind, entriesIn, feedTypesFor, feedUrl, ofKinds, withoutDuplicates } from '../src/wikipedia.almanac.js';
import type { OnThisDayResponse } from '../src/wikipedia.types.js';

const page = (title: string, description?: string) => ({
    title: title.replace(/ /g, '_'),
    titles: { normalized: title },
    ...(description === undefined ? {} : { description }),
    content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}` } },
});

describe('which endpoints are fetched', () => {
    it('reads the whole day in one request when most of it is wanted', () => {
        // 1.4 MB against three requests that come to more, and one call on a bucket the enrichment
        // walk is also using.
        expect(feedTypesFor()).toEqual(['all']);
        expect(feedTypesFor(['event', 'birth', 'death'])).toEqual(['all']);
    });

    it('reads only what a narrow caller asked for', () => {
        expect(feedTypesFor(['observance'])).toEqual(['holidays']);
        expect(feedTypesFor(['birth', 'death'])).toEqual(['births', 'deaths']);
    });

    it('reads the front page picks beside the events, because that is where notability comes from', () => {
        expect(feedTypesFor(['event'])).toEqual(['events', 'selected']);
    });

    it('does not ask the same endpoint twice for a repeated kind', () => {
        expect(feedTypesFor(['birth', 'birth'])).toEqual(['births']);
    });

    it('addresses one language edition, zero-padded', () => {
        expect(feedUrl('en', 'all', 9, 2)).toBe('https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/09/02');
        expect(almanacDate(9, 2)).toBe('09-02');
    });
});

describe('the date a caller asked about', () => {
    it('is taken as it stands when it is a date', () => {
        expect(askableDate(2, 29)).toEqual({ month: 2, day: 29 });
    });

    it('is refused rather than clamped, so a caller with a bug does not get December', () => {
        expect(askableDate(13, 1)).toBeUndefined();
        expect(askableDate(0, 1)).toBeUndefined();
        expect(askableDate(1, 32)).toBeUndefined();
        expect(askableDate('September', 20)).toBeUndefined();
    });
});

describe('what a feed entry becomes', () => {
    it('keeps the source sentence, its year and where it was read', () => {
        const response: OnThisDayResponse = {
            births: [{ year: 1966, text: 'Nuno Bettencourt, Portuguese guitarist', pages: [page('Nuno Bettencourt', 'Portuguese guitarist')] }],
        };

        expect(entriesIn(response)).toEqual([
            {
                kind: 'birth',
                year: 1966,
                text: 'Nuno Bettencourt, Portuguese guitarist',
                url: 'https://en.wikipedia.org/wiki/Nuno_Bettencourt',
                subjects: [{ title: 'Nuno Bettencourt', description: 'Portuguese guitarist', url: 'https://en.wikipedia.org/wiki/Nuno_Bettencourt' }],
            },
        ]);
    });

    it('passes the descriptions on, because they are what a station leans on', () => {
        const response: OnThisDayResponse = {
            events: [{ year: 1969, text: 'The Beatles recorded together for the last time.', pages: [page('Abbey Road', '1969 Beatles album')] }],
        };

        expect(entriesIn(response)[0]?.subjects?.[0]?.description).toBe('1969 Beatles album');
    });

    it('marks what the front page picked, by the list it arrived in', () => {
        const response: OnThisDayResponse = { selected: [{ year: 1987, text: 'Something the editors chose.', pages: [page('A page')] }] };

        expect(entriesIn(response)[0]).toMatchObject({ kind: 'event', notable: true });
    });

    it('reads a narrow endpoint and the whole day the same way', () => {
        const response: OnThisDayResponse = {
            holidays: [{ text: 'Independence Day (Somewhere)', pages: [page('Independence Day')] }],
            births: [{ year: 1948, text: 'Chuck Panozzo, American bass player', pages: [page('Chuck Panozzo')] }],
        };

        expect(entriesIn(response).map(entry => entry.kind)).toEqual(['birth', 'observance']);
    });

    it('gives an observance no year, because it is not about one', () => {
        expect(entriesIn({ holidays: [{ text: 'Some feast day' }] })[0]?.year).toBeUndefined();
    });

    it('flattens a line break, which a speech engine would read as two sentences', () => {
        const response: OnThisDayResponse = { holidays: [{ text: 'Christian feast day:\nEustace (Western Christianity)' }] };

        expect(entriesIn(response)[0]?.text).toBe('Christian feast day: Eustace (Western Christianity)');
    });

    it('drops an entry with no sentence, and keeps one with no article', () => {
        const response: OnThisDayResponse = {
            events: [
                { year: 1900, pages: [page('A page')] },
                { year: 1901, text: 'Something happened.' },
            ],
        };

        expect(entriesIn(response)).toEqual([{ kind: 'event', year: 1901, text: 'Something happened.' }]);
    });

    it('answers with nothing for a response that is not one', () => {
        expect(entriesIn(undefined)).toEqual([]);
        expect(entriesIn({ births: 'quite a few' } as unknown as OnThisDayResponse)).toEqual([]);
    });
});

describe('the same entry twice', () => {
    it('is collapsed, with the front page copy kept', () => {
        // `selected` is a subset of `events`, and both are fetched together: without this the day's
        // best line is read again ten minutes later as an ordinary one.
        const entries = entriesIn({
            selected: [{ year: 2011, text: 'A thing happened.' }],
            events: [
                { year: 2011, text: 'A thing happened.' },
                { year: 1999, text: 'Another thing happened.' },
            ],
        });

        const kept = withoutDuplicates(entries);

        expect(kept).toHaveLength(2);
        expect(kept[0]).toMatchObject({ text: 'A thing happened.', notable: true });
    });

    it('is two entries when the years differ, however alike they read', () => {
        const entries = entriesIn({
            events: [
                { year: 1970, text: 'A thing happened.' },
                { year: 1971, text: 'A thing happened.' },
            ],
        });

        expect(withoutDuplicates(entries)).toHaveLength(2);
    });
});

describe('what the caller asked for', () => {
    const day = entriesIn({
        selected: [{ year: 2011, text: 'The picked one.' }],
        events: [
            { year: 1999, text: 'An ordinary one.' },
            { year: 1998, text: 'Another ordinary one.' },
        ],
        births: [
            { year: 1966, text: 'Somebody born.' },
            { year: 1967, text: 'Somebody else born.' },
        ],
    });

    it('is the kinds it named, and everything when it named none', () => {
        expect(ofKinds(day, ['birth']).map(entry => entry.kind)).toEqual(['birth', 'birth']);
        expect(ofKinds(day)).toHaveLength(5);
    });

    it('is capped per kind rather than overall, so one kind cannot eat the limit', () => {
        const capped = cappedPerKind(day, 1);

        expect(capped.map(entry => entry.kind).sort()).toEqual(['birth', 'event']);
    });

    it('keeps the picked entries first when the cap bites, and the feed order otherwise', () => {
        const capped = cappedPerKind(day, 2);
        const events = capped.filter(entry => entry.kind === 'event');

        expect(events.some(entry => entry.notable === true)).toBe(true);
        // The survivors come back in the order they arrived: the picked list is read first, so its
        // entry leads, and the cap decided only which of the ordinary ones went with it.
        expect(events).toHaveLength(2);
    });

    it('caps nothing when no limit was given', () => {
        expect(cappedPerKind(day)).toHaveLength(5);
    });
});
