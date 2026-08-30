// The floor under a weather break: no network, no model, and no way to fail that costs the station
// a break it could have had.
//
// Two things carry the weight. The DECLINE, because a break that announced the weather and then said
// nothing is worse than the slot being passed over. And what `reportOf` will and will not say, which
// is this writer's whole safety property: it states figures a service measured, and never compares,
// advises or characterises — those are sentences nothing can check against a source.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { reportOf, WeatherBreakWriter, WEATHER_BREAK_KEYS, WEATHER_TEMPLATES } from '../../../src/modules/director/weather.break.writer.js';
import { unknownPlaceholders } from '../../../src/modules/director/break.templates.js';
import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import type { SpokenWeather } from '../../../src/modules/weather/weather.words.js';
import { WEATHER_KIND } from '../../../src/modules/weather/weather.kind.js';

const reading = (overrides: Partial<SpokenWeather> = {}): SpokenWeather => ({
    place: 'Atlanta',
    observedAt: '2026-08-29T09:00:00-04:00',
    units: 'metric',
    current: { condition: 'rain', words: 'raining', temperature: 17 },
    ...overrides,
});

const build = (settings: Record<string, string> = {}) => {
    const config = { get: (key: string, fallback?: unknown) => settings[key] ?? fallback } as unknown as AppConfig;
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    return { writer: new WeatherBreakWriter(config, logger), logger };
};

const request = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({
    kind: WEATHER_KIND,
    weather: reading(),
    ...overrides,
});

describe('the shipped phrasings', () => {
    it('name nothing the station cannot fill', async () => {
        for (const template of WEATHER_TEMPLATES) expect(unknownPlaceholders(template)).toEqual([]);
    });

    it('every one carries the reading outside its optional parts', () => {
        // A phrasing that could drop the reading is one that can produce "And now the weather. Next
        // up, The Cure."
        for (const template of WEATHER_TEMPLATES) {
            const required = template.replace(/\[\[[^\]]*\]\]/g, '');
            expect(required).toContain('{{weather.report}}');
        }
    });

    it('puts the reading after a full stop, because the report is a capitalised sentence', () => {
        for (const template of WEATHER_TEMPLATES) {
            const at = template.indexOf('{{weather.report}}');
            expect(template.slice(0, at).trimEnd().endsWith('.')).toBe(true);
        }
    });
});

describe('reportOf', () => {
    it('states the figure and the sky, and where', () => {
        expect(reportOf(reading())).toBe("It's 17 degrees and raining in Atlanta.");
    });

    it('says the sky alone when the service reported no temperature', () => {
        // A condition on its own is a real break; a figure the service never sent is not.
        const noFigure = reading({ current: { condition: 'fog', words: 'foggy' } });
        expect(reportOf(noFigure)).toBe("It's foggy in Atlanta.");
    });

    it("adds today's high when the reading carries a forecast for it", () => {
        const withToday = reading({ days: [{ date: '2026-08-29', condition: 'clear', words: 'clear', high: 24, low: 12 }] });
        expect(reportOf(withToday)).toBe("It's 17 degrees and raining in Atlanta. A high of 24 today, down to 12 overnight.");
    });

    it('gives the high without the low, since a night nobody has reached is not the sentence', () => {
        const highOnly = reading({ days: [{ date: '2026-08-29', condition: 'clear', words: 'clear', high: 24 }] });
        expect(reportOf(highOnly)).toBe("It's 17 degrees and raining in Atlanta. A high of 24 today.");
    });

    it('reads only the FIRST day, whatever the operator asked to be fetched', () => {
        // A break between two records is one sentence about now and at most one about later. The
        // extra days are fetched for a model binding, which can pick the one worth mentioning.
        const week = reading({
            days: [
                { date: '2026-08-29', condition: 'clear', words: 'clear', high: 24 },
                { date: '2026-08-30', condition: 'rain', words: 'raining', high: 19 },
            ],
        });

        expect(reportOf(week)).not.toContain('19');
    });

    it('says nothing about yesterday, a coat, or how lovely it is', () => {
        // The safety property, asserted as an absence because that is what it is: every one of those
        // is a sentence nothing can check against a source.
        const said = reportOf(reading({ days: [{ date: '2026-08-29', condition: 'clear', words: 'clear', high: 24, low: 12 }] })) ?? '';

        expect(said).not.toMatch(/yesterday|warmer|colder|lovely|wrap up|umbrella/i);
    });

    it('leaves the place off rather than saying "in ."', () => {
        expect(reportOf(reading({ place: '   ' }))).toBe("It's 17 degrees and raining.");
    });
});

describe('writing', () => {
    it('produces a break from a reading', async () => {
        const { writer } = build();

        const written = await writer.write(request());

        expect(written?.script).toContain("It's 17 degrees and raining in Atlanta.");
        expect(written?.label).toBe('Weather');
    });

    it('declines when there is no reading, rather than announcing the weather it does not have', async () => {
        const { writer } = build();

        expect(await writer.write(request({ weather: undefined }))).toBeUndefined();
    });

    it('says nothing about which sort of nothing it was, because the source already did', async () => {
        // A writer given the reason could only repeat it, and only `WeatherSource` can tell the three
        // apart.
        const { writer, logger } = build();

        await writer.write(request({ weather: undefined }));

        expect(logger.info).not.toHaveBeenCalled();
    });

    it('names the location in the label when a band asked for one', async () => {
        const { writer } = build();

        const written = await writer.write(request({ subject: { key: 'town', label: 'town' } }));

        expect(written?.label).toBe('Weather: town');
    });

    it("can say where it is about even with no subject, which the station's own weather has none of", async () => {
        // `{{weather.place}}` is filled from the reading, not from the subject: a break about the
        // station's own place should still be able to say "The weather in Atlanta now".
        const { writer } = build({ [WEATHER_BREAK_KEYS.templates]: 'The weather in {{weather.place}} now. {{weather.report}}' });

        const written = await writer.write(request());

        expect(written?.script).toBe("The weather in Atlanta now. It's 17 degrees and raining in Atlanta.");
    });

    it("prefers the operator's own label for the place over the one the service resolved", async () => {
        const { writer } = build({ [WEATHER_BREAK_KEYS.templates]: 'The weather in {{weather.place}} now. {{weather.report}}' });

        const written = await writer.write(request({ subject: { key: 'town', label: 'town' } }));

        expect(written?.script).toContain('The weather in town now.');
    });

    it("restores the station's own phrasings when the operator clears the box", async () => {
        const { writer } = build({ [WEATHER_BREAK_KEYS.templates]: '   ' });

        expect(await writer.write(request())).toBeDefined();
    });

    it('declines when every phrasing needs something this moment has not got', async () => {
        // The reading exists and there is no frame to read it in, which is a slot passed over rather
        // than a bare temperature with no station attached to it.
        const { writer } = build({ [WEATHER_BREAK_KEYS.templates]: 'Here on {{station.name}}. {{weather.report}}' });

        expect(await writer.write(request())).toBeUndefined();
    });

    it('reports which phrasing it used, so the record can say', async () => {
        const { writer } = build({ [WEATHER_BREAK_KEYS.templates]: 'And now the weather. {{weather.report}}' });

        await writer.write(request());

        expect(writer.detailOfLastWrite()).toEqual({ source: 'And now the weather. {{weather.report}}' });
    });

    it('clears what it reports when a later write declined', async () => {
        const { writer } = build();

        await writer.write(request());
        await writer.write(request({ weather: undefined }));

        expect(writer.detailOfLastWrite()).toBeUndefined();
    });

    it('claims the record coming up only when the phrasing really named it', async () => {
        const { writer } = build({ [WEATHER_BREAK_KEYS.templates]: 'And now the weather. {{weather.report}} Next up, {{next.artist}}.' });

        const written = await writer.write(request({ next: { title: 'Solid Air', artist: 'John Martyn' } }));

        expect(written?.claimsNext).toBe(true);
    });

    it('does not claim one when it did not', async () => {
        const { writer } = build({ [WEATHER_BREAK_KEYS.templates]: 'And now the weather. {{weather.report}}' });

        const written = await writer.write(request({ next: { title: 'Solid Air', artist: 'John Martyn' } }));

        expect(written?.claimsNext).toBe(false);
    });

    it('stamps how long the reading stays true, whatever the phrasing was', async () => {
        // Unconditional where the two claims above are answered, and the shortest phrasing there is
        // proves it: every phrasing carries the reading, so every weather break reports the present.
        const { writer } = build({ [WEATHER_BREAK_KEYS.templates]: 'And now the weather. {{weather.report}}' });

        const written = await writer.write(request({ weatherFreshUntil: 1_800_000 }));

        expect(written?.claimsReadingUntil).toBe(1_800_000);
    });

    it('stamps nothing when the source gave it no expiry', async () => {
        // The two arrive together from `WeatherSource`, so this is the shape of a caller that
        // predates the field rather than a state the station reaches.
        const { writer } = build();

        expect((await writer.write(request()))?.claimsReadingUntil).toBeUndefined();
    });
});
