// What a weather break is written from, fetched once for whichever writer takes it.
//
// The half worth testing hardest is the three ways of having nothing: no plugin, nowhere named, and
// a service that would not answer. They are one outcome to the writer and three different things for
// an operator to do, and this source is the only thing that can tell them apart — so each one is
// asserted to say so.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { DEFAULT_WEATHER_DAYS, MAX_WEATHER_DAYS, WeatherSource, WEATHER_SOURCE_KEYS } from '../../../src/modules/director/weather.source.js';
import type { WeatherService } from '../../../src/modules/weather/weather.service.js';
import type { SpokenWeather } from '../../../src/modules/weather/weather.words.js';
import type { TopicRepository } from '../../../src/modules/topics/topic.repository.js';
import type { Topic } from '../../../src/modules/topics/topic.js';
import { WEATHER_KIND } from '../../../src/modules/weather/weather.kind.js';

const READING: SpokenWeather = {
    place: 'Atlanta, Georgia',
    observedAt: '2026-08-29T09:00:00-04:00',
    units: 'metric',
    current: { condition: 'rain', words: 'raining', temperature: 17 },
};

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

        expect(await source.readingFor('talkbreak', undefined)).toBeUndefined();
        expect(read).not.toHaveBeenCalled();
    });
});

describe('the three ways of having nothing', () => {
    it('says so when no weather plugin is installed, and names the fix', async () => {
        const { source, logger } = harness({ hasWeather: false });

        expect(await source.readingFor(WEATHER_KIND, undefined)).toEqual({});
        expect(vi.mocked(logger.info).mock.calls[0]?.[0]).toMatch(/weather plugin/);
    });

    it('says so when the station has not said where it is, and names the setting', async () => {
        // The one decline an operator can fix in ten seconds and would never guess.
        const { source, logger } = harness({ home: undefined });

        expect(await source.readingFor(WEATHER_KIND, undefined)).toEqual({});
        expect(vi.mocked(logger.info).mock.calls[0]?.[0]).toMatch(/Where the station is/);
    });

    it('says so when the service had no reading, which is the one worth an operator watching for', async () => {
        // A station whose clock asks for the weather every hour and whose service is refusing is
        // silent every hour, and this is the line that says so.
        const { source, logger } = harness({ reading: undefined });

        expect(await source.readingFor(WEATHER_KIND, undefined)).toEqual({});
        expect(vi.mocked(logger.info).mock.calls[0]?.[0]).toMatch(/no reading/);
    });

    it('absorbs a throw rather than taking the job with it', async () => {
        const { source, logger } = harness({ readThrows: true });

        expect(await source.readingFor(WEATHER_KIND, undefined)).toEqual({});
        expect(logger.warn).toHaveBeenCalled();
    });
});

describe('where it reports on', () => {
    it("asks about the station's own place when the band named no location", async () => {
        const { source, read } = harness();

        const report = await source.readingFor(WEATHER_KIND, undefined);

        expect(read).toHaveBeenCalledWith('Atlanta', DEFAULT_WEATHER_DAYS, undefined);
        expect(report?.reading).toEqual(READING);
        expect(report?.subject).toBeUndefined();
    });

    it("resolves a band's location to a place, and reports the subject back", async () => {
        const { source, read } = harness({ topics: [location('town', 'town', { place: 'Chipping Norton, Oxfordshire' })] });

        const report = await source.readingFor(WEATHER_KIND, { topic: 'town' });

        expect(read).toHaveBeenCalledWith('Chipping Norton, Oxfordshire', DEFAULT_WEATHER_DAYS, undefined);
        expect(report?.subject).toEqual({ key: 'town', label: 'town' });
    });

    it("honours a location's own units override", async () => {
        const { source, read } = harness({ topics: [location('boston', 'Boston', { place: 'Boston, MA', units: 'imperial' })] });

        await source.readingFor(WEATHER_KIND, { topic: 'boston' });

        expect(read).toHaveBeenCalledWith('Boston, MA', DEFAULT_WEATHER_DAYS, 'imperial');
    });

    it("falls back to the station's own place for a location that has since been deleted", async () => {
        // A stale band rather than a mistake, and unlike a news category there is no risk of airing
        // the wrong thing under the right name: the reading names the place it is about.
        const { source, read } = harness({ topics: [] });

        const report = await source.readingFor(WEATHER_KIND, { topic: 'a-place-that-went-away' });

        expect(read).toHaveBeenCalledWith('Atlanta', DEFAULT_WEATHER_DAYS, undefined);
        expect(report?.subject).toBeUndefined();
    });

    it('covers the station itself when the topics table could not be read', async () => {
        const { source, read } = harness({ topicsThrow: true });

        await source.readingFor(WEATHER_KIND, { topic: 'town' });

        expect(read).toHaveBeenCalledWith('Atlanta', DEFAULT_WEATHER_DAYS, undefined);
    });

    it('keeps the subject even when there was no reading, so a decline can name the place', async () => {
        const { source } = harness({ reading: undefined, topics: [location('town', 'town', { place: 'Chipping Norton' })] });

        expect(await source.readingFor(WEATHER_KIND, { topic: 'town' })).toEqual({ subject: { key: 'town', label: 'town' } });
    });
});

describe('how far ahead', () => {
    it('reads the setting as the STRING it is stored as', async () => {
        const { source, read } = harness({ settings: { [WEATHER_SOURCE_KEYS.days]: '3' } });

        await source.readingFor(WEATHER_KIND, undefined);

        expect(read).toHaveBeenCalledWith('Atlanta', 3, undefined);
    });

    it('takes zero, which is the conditions alone and a real thing to want', async () => {
        const { source, read } = harness({ settings: { [WEATHER_SOURCE_KEYS.days]: '0' } });

        await source.readingFor(WEATHER_KIND, undefined);

        expect(read).toHaveBeenCalledWith('Atlanta', 0, undefined);
    });

    it('CLAMPS a stored row rather than refusing it, since a setting that will not load stops the break', async () => {
        const { source, read } = harness({ settings: { [WEATHER_SOURCE_KEYS.days]: '90' } });

        await source.readingFor(WEATHER_KIND, undefined);

        expect(read).toHaveBeenCalledWith('Atlanta', MAX_WEATHER_DAYS, undefined);
    });

    it('takes the default for a row nobody can parse', async () => {
        const { source, read } = harness({ settings: { [WEATHER_SOURCE_KEYS.days]: 'soon' } });

        await source.readingFor(WEATHER_KIND, undefined);

        expect(read).toHaveBeenCalledWith('Atlanta', DEFAULT_WEATHER_DAYS, undefined);
    });
});
