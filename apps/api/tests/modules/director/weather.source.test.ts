// What a weather break is written from, fetched once for whichever writer takes it.
//
// The half worth testing hardest is the four ways of having nothing: no plugin, nowhere named, a
// service that would not answer, and a reading that will be too old to be true by the time the break
// airs. They are one outcome to the writer and four different things for an operator to do, and this
// source is the only thing that can tell them apart — so each one is asserted to say so.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import {
    DEFAULT_WEATHER_DAYS,
    DEFAULT_WEATHER_MAX_AGE_MINUTES,
    MAX_WEATHER_DAYS,
    MAX_WEATHER_MAX_AGE_MINUTES,
    MIN_WEATHER_MAX_AGE_MINUTES,
    WeatherSource,
    WEATHER_SOURCE_KEYS,
} from '../../../src/modules/director/weather.source.js';
import type { WeatherService } from '../../../src/modules/weather/weather.service.js';
import type { SpokenWeather } from '../../../src/modules/weather/weather.words.js';
import type { TopicRepository } from '../../../src/modules/topics/topic.repository.js';
import type { Topic } from '../../../src/modules/topics/topic.js';
import { WEATHER_KIND } from '../../../src/modules/weather/weather.kind.js';

/** A fixed "now", so every assertion about a reading's age is about arithmetic rather than luck. */
const NOW = Date.parse('2026-08-30T14:00:00Z');
const MINUTE = 60_000;

/** A reading observed this many minutes before {@link NOW}. */
const observed = (minutesAgo: number): SpokenWeather => ({
    place: 'Atlanta, Georgia',
    observedAt: new Date(NOW - minutesAgo * MINUTE).toISOString(),
    units: 'metric',
    current: { condition: 'rain', words: 'raining', temperature: 17 },
});

/** Fresh by any setting, which is what every test that is not about the age wants. */
const READING = observed(10);

const location = (key: string, label: string, config: Record<string, unknown>): Topic => ({
    id: `topic-${key}`,
    kind: WEATHER_KIND,
    key,
    label,
    position: 0,
    config,
});

interface Options {
    hasWeather?: boolean;
    home?: string;
    reading?: SpokenWeather | undefined;
    readThrows?: boolean;
    topics?: Topic[];
    topicsThrow?: boolean;
    settings?: Record<string, string>;
}

function harness(options: Options = {}) {
    const read = vi.fn(async (_place?: string, _days?: number, _units?: string): Promise<SpokenWeather | undefined> => {
        if (options.readThrows) throw new Error('the weather module fell over');
        return 'reading' in options ? options.reading : READING;
    });

    const weather = {
        hasWeather: () => options.hasWeather ?? true,
        home: () => ('home' in options ? options.home : 'Atlanta'),
        units: () => 'metric',
        read,
    } as unknown as WeatherService;

    const list = vi.fn(async () => {
        if (options.topicsThrow) throw new Error('the topics table is unreachable');
        return options.topics ?? [];
    });
    const topics = { list } as unknown as TopicRepository;

    // Settings as the STRINGS a config layer actually holds, which is what makes the clamp
    // assertions below prove anything.
    const config = { get: (key: string, fallback?: unknown) => options.settings?.[key] ?? fallback } as unknown as AppConfig;
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

    return { source: new WeatherSource(weather, topics, config, logger), read, logger };
}

describe('which kinds it answers for', () => {
    it('answers nothing at all for a kind that is not about the weather', async () => {
        // What keeps the branch about the weather inside a file about the weather: this job serves
        // every kind, and asking a service costs a request.
        const { source, read } = harness();

        expect(await source.readingFor('talkbreak', undefined, NOW)).toBeUndefined();
        expect(read).not.toHaveBeenCalled();
    });
});

describe('the four ways of having nothing', () => {
    it('says so when no weather plugin is installed, and names the fix', async () => {
        const { source, logger } = harness({ hasWeather: false });

        expect(await source.readingFor(WEATHER_KIND, undefined, NOW)).toEqual({});
        expect(vi.mocked(logger.info).mock.calls[0]?.[0]).toMatch(/weather plugin/);
    });

    it('says so when the station has not said where it is, and names the setting', async () => {
        // The one decline an operator can fix in ten seconds and would never guess.
        const { source, logger } = harness({ home: undefined });

        expect(await source.readingFor(WEATHER_KIND, undefined, NOW)).toEqual({});
        expect(vi.mocked(logger.info).mock.calls[0]?.[0]).toMatch(/Where the station is/);
    });

    it('says so when the service had no reading, which is the one worth an operator watching for', async () => {
        // A station whose clock asks for the weather every hour and whose service is refusing is
        // silent every hour, and this is the line that says so.
        const { source, logger } = harness({ reading: undefined });

        expect(await source.readingFor(WEATHER_KIND, undefined, NOW)).toEqual({});
        expect(vi.mocked(logger.info).mock.calls[0]?.[0]).toMatch(/no reading/);
    });

    it('absorbs a throw rather than taking the job with it', async () => {
        const { source, logger } = harness({ readThrows: true });

        expect(await source.readingFor(WEATHER_KIND, undefined, NOW)).toEqual({});
        expect(logger.warn).toHaveBeenCalled();
    });
});

describe('where it reports on', () => {
    it("asks about the station's own place when the band named no location", async () => {
        const { source, read } = harness();

        const report = await source.readingFor(WEATHER_KIND, undefined, NOW);

        expect(read).toHaveBeenCalledWith('Atlanta', DEFAULT_WEATHER_DAYS, undefined);
        expect(report?.reading).toEqual(READING);
        expect(report?.subject).toBeUndefined();
    });

    it("resolves a band's location to a place, and reports the subject back", async () => {
        const { source, read } = harness({ topics: [location('town', 'town', { place: 'Chipping Norton, Oxfordshire' })] });

        const report = await source.readingFor(WEATHER_KIND, { topic: 'town' }, NOW);

        expect(read).toHaveBeenCalledWith('Chipping Norton, Oxfordshire', DEFAULT_WEATHER_DAYS, undefined);
        expect(report?.subject).toEqual({ key: 'town', label: 'town' });
    });

    it("honours a location's own units override", async () => {
        const { source, read } = harness({ topics: [location('boston', 'Boston', { place: 'Boston, MA', units: 'imperial' })] });

        await source.readingFor(WEATHER_KIND, { topic: 'boston' }, NOW);

        expect(read).toHaveBeenCalledWith('Boston, MA', DEFAULT_WEATHER_DAYS, 'imperial');
    });

    it("falls back to the station's own place for a location that has since been deleted", async () => {
        // A stale band rather than a mistake, and unlike a news category there is no risk of airing
        // the wrong thing under the right name: the reading names the place it is about.
        const { source, read } = harness({ topics: [] });

        const report = await source.readingFor(WEATHER_KIND, { topic: 'a-place-that-went-away' }, NOW);

        expect(read).toHaveBeenCalledWith('Atlanta', DEFAULT_WEATHER_DAYS, undefined);
        expect(report?.subject).toBeUndefined();
    });

    it('covers the station itself when the topics table could not be read', async () => {
        const { source, read } = harness({ topicsThrow: true });

        await source.readingFor(WEATHER_KIND, { topic: 'town' }, NOW);

        expect(read).toHaveBeenCalledWith('Atlanta', DEFAULT_WEATHER_DAYS, undefined);
    });

    it('keeps the subject even when there was no reading, so a decline can name the place', async () => {
        const { source } = harness({ reading: undefined, topics: [location('town', 'town', { place: 'Chipping Norton' })] });

        expect(await source.readingFor(WEATHER_KIND, { topic: 'town' }, NOW)).toEqual({ subject: { key: 'town', label: 'town' } });
    });
});

describe('how far ahead', () => {
    it('reads the setting as the STRING it is stored as', async () => {
        const { source, read } = harness({ settings: { [WEATHER_SOURCE_KEYS.days]: '3' } });

        await source.readingFor(WEATHER_KIND, undefined, NOW);

        expect(read).toHaveBeenCalledWith('Atlanta', 3, undefined);
    });

    it('takes zero, which is the conditions alone and a real thing to want', async () => {
        const { source, read } = harness({ settings: { [WEATHER_SOURCE_KEYS.days]: '0' } });

        await source.readingFor(WEATHER_KIND, undefined, NOW);

        expect(read).toHaveBeenCalledWith('Atlanta', 0, undefined);
    });

    it('CLAMPS a stored row rather than refusing it, since a setting that will not load stops the break', async () => {
        const { source, read } = harness({ settings: { [WEATHER_SOURCE_KEYS.days]: '90' } });

        await source.readingFor(WEATHER_KIND, undefined, NOW);

        expect(read).toHaveBeenCalledWith('Atlanta', MAX_WEATHER_DAYS, undefined);
    });

    it('takes the default for a row nobody can parse', async () => {
        const { source, read } = harness({ settings: { [WEATHER_SOURCE_KEYS.days]: 'soon' } });

        await source.readingFor(WEATHER_KIND, undefined, NOW);

        expect(read).toHaveBeenCalledWith('Atlanta', DEFAULT_WEATHER_DAYS, undefined);
    });
});

describe('how old a reading may be when it airs', () => {
    it('reports a reading comfortably inside the window', async () => {
        const { source } = harness({ reading: observed(30) });

        expect((await source.readingFor(WEATHER_KIND, undefined, NOW))?.reading).toBeDefined();
    });

    it('declines one already past the window, and names both fixes', async () => {
        const { source, logger } = harness({ reading: observed(DEFAULT_WEATHER_MAX_AGE_MINUTES + 1) });

        expect(await source.readingFor(WEATHER_KIND, undefined, NOW)).toEqual({});
        expect(vi.mocked(logger.info).mock.calls[0]?.[0]).toMatch(/too old to be true when it airs/);
    });

    it('judges the age against the SLOT rather than against now, which is the whole bug', async () => {
        // Fresh at the keyboard and stale on air: written now, aired eight records later. Nothing
        // before this asked the second question, so a reading like this went out as a statement
        // about a sky nobody had looked at in three hours.
        const { source } = harness({ reading: observed(DEFAULT_WEATHER_MAX_AGE_MINUTES - 10) });

        expect((await source.readingFor(WEATHER_KIND, undefined, NOW))?.reading).toBeDefined();
        expect(await source.readingFor(WEATHER_KIND, undefined, NOW + 30 * MINUTE)).toEqual({});
    });

    it('keeps the subject on the decline, so a log line can still name the place', async () => {
        const { source } = harness({
            reading: observed(DEFAULT_WEATHER_MAX_AGE_MINUTES + 1),
            topics: [location('town', 'town', { place: 'Chipping Norton' })],
        });

        expect(await source.readingFor(WEATHER_KIND, { topic: 'town' }, NOW)).toEqual({ subject: { key: 'town', label: 'town' } });
    });

    it('treats an undateable observation as too old rather than as fresh', async () => {
        // `WeatherService` already refuses a blank one, so this is a plugin doing what the
        // capability forbids. Failing toward a slot passed over beats failing toward a confident
        // sentence about a sky nobody measured.
        const { source } = harness({ reading: { ...READING, observedAt: 'earlier on' } });

        expect(await source.readingFor(WEATHER_KIND, undefined, NOW)).toEqual({});
    });

    it('reads the setting as the STRING it is stored as', async () => {
        // A test that hands over a real number proves nothing here: every layer of `AppConfig`
        // holds text, and `get`'s overload widens its return from the DEFAULT.
        const { source } = harness({
            reading: observed(200),
            settings: { [WEATHER_SOURCE_KEYS.maxAgeMinutes]: '240' },
        });

        expect((await source.readingFor(WEATHER_KIND, undefined, NOW))?.reading).toBeDefined();
    });

    it('CLAMPS a stored row rather than refusing it, at both ends', async () => {
        const tooWide = harness({ reading: observed(MAX_WEATHER_MAX_AGE_MINUTES + 60), settings: { [WEATHER_SOURCE_KEYS.maxAgeMinutes]: '9000' } });
        expect(await tooWide.source.readingFor(WEATHER_KIND, undefined, NOW)).toEqual({});

        const tooTight = harness({ reading: observed(MIN_WEATHER_MAX_AGE_MINUTES - 1), settings: { [WEATHER_SOURCE_KEYS.maxAgeMinutes]: '1' } });
        expect((await tooTight.source.readingFor(WEATHER_KIND, undefined, NOW))?.reading).toBeDefined();
    });

    it('takes the default for a row nobody can parse', async () => {
        const { source } = harness({
            reading: observed(DEFAULT_WEATHER_MAX_AGE_MINUTES + 1),
            settings: { [WEATHER_SOURCE_KEYS.maxAgeMinutes]: 'a while' },
        });

        expect(await source.readingFor(WEATHER_KIND, undefined, NOW)).toEqual({});
    });
});
