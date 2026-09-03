// The station's feed order is stored as a settings row an operator edits through a table and, on a
// bad day, by hand. What matters is that neither shape can cost the station its bulletin: anything
// unreadable is "no roster", which reads every feed, rather than a bulletin that cannot be written.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { NEWS_FEEDS_KEY, feedRoster } from '../../../src/modules/news/news.settings.js';

const config = (stored?: unknown): AppConfig =>
    ({
        get: vi.fn((key: string, fallback: unknown) => (key === NEWS_FEEDS_KEY && stored !== undefined ? stored : fallback)),
    }) as unknown as AppConfig;

const rows = (...feeds: string[]): string => JSON.stringify(feeds.map(feed => ({ feed })));

describe('feedRoster', () => {
    it('answers the feeds in the order the operator put them in', () => {
        expect(feedRoster(config(rows('deadair.rss:world', 'deadair.rss:sport')))).toEqual(['deadair.rss:world', 'deadair.rss:sport']);
    });

    it('answers nothing for a station that has written no list, which reads every feed', () => {
        expect(feedRoster(config())).toEqual([]);
        expect(feedRoster(config(''))).toEqual([]);
        expect(feedRoster(config('[]'))).toEqual([]);
    });

    // Keeping the FIRST: a feed listed twice is one the operator wanted early and then wrote again,
    // not one that should take two turns in the bulletin.
    it('reads a feed listed twice as one feed, in its earlier place', () => {
        expect(feedRoster(config(rows('a', 'b', 'a')))).toEqual(['a', 'b']);
    });

    it('drops a blank row, which the form leaves behind whenever somebody thinks better of one', () => {
        expect(feedRoster(config(JSON.stringify([{ feed: 'a' }, { feed: '   ' }, {}, { feed: 'b' }])))).toEqual(['a', 'b']);
    });

    it('reads a row somebody has broken as no roster rather than throwing on the way to air', () => {
        expect(feedRoster(config('not json at all'))).toEqual([]);
        expect(feedRoster(config('{"feed":"a"}'))).toEqual([]);
        expect(feedRoster(config(JSON.stringify([{ feed: 42 }])))).toEqual([]);
    });
});
