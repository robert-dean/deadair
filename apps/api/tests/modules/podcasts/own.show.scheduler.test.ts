// A news show on the format clock: the station makes tonight's edition ahead of its band and airs it
// at the band, as that show's episode, without anybody asking for it from the console.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { aheadFor, forgetRefusals, NEWS_MIN_AHEAD_MS, OwnShowScheduler, REFUSED_RETRY_MS } from '../../../src/modules/podcasts/own.show.scheduler.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/** Strings, because every layer of `AppConfig` holds them. */
const config = (rows: Record<string, string> = {}): AppConfig =>
    ({ get: (key: string, fallback: unknown) => ({ 'station.timezone': 'UTC', ...rows })[key] ?? fallback }) as never;

const topic = { id: 'topic-1', key: 'evening-news', label: 'Evening News' };
const eighteen = { at: 'clock', hour: 18, minute: 0, kind: 'podcast', topic };

// Two hours before 18:00, inside the three-hour read-ahead.
const now = Date.UTC(2026, 9, 27, 16, 0, 0);
const slot = Date.UTC(2026, 9, 27, 18, 0, 0);

function build(
    options: {
        bands?: Record<string, unknown>[];
        topics?: { id: string; config: Record<string, unknown> }[];
        scheduled?: { kind: string; scheduledFor: number; showId?: string }[];
        refuse?: boolean;
        rows?: Record<string, string>;
        shows?: { id: string; newsFeedIds?: string[]; targetMs?: number }[];
    } = {},
) {
    const bands = { active: vi.fn(async () => options.bands ?? [eighteen]) };
    const topics = { list: vi.fn(async () => options.topics ?? [{ id: 'topic-1', config: { show: 'show-1' } }]) };
    const records = { list: vi.fn(async () => options.shows ?? [{ id: 'show-1' }]) };
    const productions = { scheduledAfter: vi.fn(async () => options.scheduled ?? []) };
    const shows = {
        requestEpisode: vi.fn(async (id: string) => {
            if (options.refuse === true) throw new Error('found no stories on its feeds');
            return { id: `episode-of-${id}` };
        }),
    };

    return {
        shows,
        scheduler: new OwnShowScheduler(
            bands as never,
            topics as never,
            shows as never,
            records as never,
            productions as never,
            config(options.rows),
            logger as never,
        ),
    };
}

beforeEach(() => {
    forgetRefusals();
    logger.warn.mockClear();
});

describe('making the station’s own shows the clock wants', () => {
    it("asks the show for an episode at the band's time", async () => {
        const { scheduler, shows } = build();

        expect(await scheduler.ripen(now)).toBe(1);

        expect(shows.requestEpisode).toHaveBeenCalledTimes(1);
        const [showId, body] = shows.requestEpisode.mock.calls[0] as unknown as [string, { airAt: { toMillis(): number } }];
        expect(showId).toBe('show-1');
        expect(body.airAt.toMillis()).toBe(slot);
    });

    it('commissions nothing twice for one slot', async () => {
        const { scheduler, shows } = build({ scheduled: [{ kind: 'podcast', scheduledFor: slot, showId: 'show-1' }] });

        expect(await scheduler.ripen(now)).toBe(0);
        expect(shows.requestEpisode).not.toHaveBeenCalled();
    });

    it('leaves a slot too far ahead for a later pass', async () => {
        const { scheduler, shows } = build();

        await scheduler.ripen(Date.UTC(2026, 9, 27, 12, 0, 0));

        expect(shows.requestEpisode).not.toHaveBeenCalled();
    });

    // A podcast band with no topic is the production scheduler's, and a band whose topic was deleted names nothing.
    it('passes over a band with no show, and a topic that names none', async () => {
        const untopiced = build({ bands: [{ at: 'clock', hour: 18, minute: 0, kind: 'podcast' }] });
        await untopiced.scheduler.ripen(now);
        expect(untopiced.shows.requestEpisode).not.toHaveBeenCalled();

        const gone = build({ topics: [] });
        await gone.scheduler.ripen(now);
        expect(gone.shows.requestEpisode).not.toHaveBeenCalled();
    });

    // A station that took `podcast` out of its production kinds has said a band naming it is a break.
    it('makes nothing when podcast is not a production kind on this station', async () => {
        const { scheduler, shows } = build({ rows: { 'render.productionKinds': 'callin' } });

        await scheduler.ripen(now);

        expect(shows.requestEpisode).not.toHaveBeenCalled();
    });

    // A news show with nothing on its feeds yet. Asked on every commit pass, it would read the feeds every
    // few seconds and log the same refusal each time.
    it('asks a refusing show again only after a while, and says so once', async () => {
        const { scheduler, shows } = build({ refuse: true });

        expect(await scheduler.ripen(now)).toBe(0);
        expect(await scheduler.ripen(now + 5_000)).toBe(0);
        expect(shows.requestEpisode).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledTimes(1);

        await scheduler.ripen(now + REFUSED_RETRY_MS + 1);
        expect(shows.requestEpisode).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });
});

// Every minute of read-ahead is a minute older the news is when it airs, so a news edition is asked for
// no earlier than its length needs.
describe('how far ahead a show is asked for', () => {
    const minutes = (n: number) => n * 60_000;

    it('gives a show that does not read the news the full read-ahead', () => {
        expect(aheadFor({ targetMs: minutes(10) }, config())).toBe(minutes(180));
    });

    it('gives a news show six minutes of making per minute it runs, between an hour and three', () => {
        expect(aheadFor({ newsFeedIds: ['f'], targetMs: minutes(15) }, config())).toBe(minutes(90));
        expect(aheadFor({ newsFeedIds: ['f'], targetMs: minutes(5) }, config())).toBe(NEWS_MIN_AHEAD_MS);
        expect(aheadFor({ newsFeedIds: ['f'], targetMs: minutes(30) }, config())).toBe(minutes(180));
    });

    // Reckoned at the longest the station would make, so a show that comes out long is not starved.
    it("reckons a news show with no length of its own at the top of the station's range", () => {
        expect(aheadFor({ newsFeedIds: ['f'] }, config({ 'render.productionMinutesMax': '20' }))).toBe(minutes(120));
    });

    it('leaves a fifteen-minute news edition two hours out for a later pass', async () => {
        const { scheduler, shows } = build({ shows: [{ id: 'show-1', newsFeedIds: ['f'], targetMs: minutes(15) }] });

        await scheduler.ripen(now);
        expect(shows.requestEpisode).not.toHaveBeenCalled();

        await scheduler.ripen(slot - minutes(90));
        expect(shows.requestEpisode).toHaveBeenCalledTimes(1);
    });
});
