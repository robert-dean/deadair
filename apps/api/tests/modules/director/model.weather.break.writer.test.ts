// The model binding for a weather break. Everything here is about what it will not do: give a
// forecast it was not given, ask a model at all when there is no reading, or air an answer carrying
// a figure nobody measured.
//
// That last one is this kind's own check and does not exist anywhere else in the station, because
// this is the one break whose claims ARE numbers and whose true ones are known exactly. A plausible
// temperature is much easier for a model to write than a plausible news story — it knows roughly
// what August in Atlanta is like — so the shape guards every other writer shares would not catch it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { LlmMessage } from '@deadair/plugin-sdk';
import type { Logger } from '@maroonedsoftware/logger';

import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import { inventedFigure, ModelWeatherBreakWriter, WEATHER_MAX_WORDS } from '../../../src/modules/director/model.weather.break.writer.js';
import { MODEL_WRITER_KEYS } from '../../../src/modules/director/model.talk.break.writer.js';
import { WEATHER_KIND } from '../../../src/modules/weather/weather.kind.js';
import type { SpokenWeather } from '../../../src/modules/weather/weather.words.js';
import type { LlmService } from '../../../src/modules/llm/llm.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const config = (values: Record<string, unknown> = {}): AppConfig =>
    ({ get: vi.fn((key: string, fallback: unknown) => values[key] ?? fallback) }) as unknown as AppConfig;

const enabled = { [MODEL_WRITER_KEYS.enabled]: true };

const READING: SpokenWeather = {
    place: 'Atlanta',
    observedAt: '2026-08-29T09:00:00-04:00',
    units: 'metric',
    current: { condition: 'rain', words: 'raining', temperature: 17, wind: 20, humidity: 72 },
    days: [{ date: '2026-08-29', condition: 'clear', words: 'clear', high: 24, low: 12, precipitationChance: 40 }],
};

const request = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({
    kind: WEATHER_KIND,
    station: 'Deadair',
    weather: READING,
    ...overrides,
});

function build(answer: string, values: Record<string, unknown> = enabled) {
    const converse = vi.fn(async (_asked: { messages: LlmMessage[] }, _options?: unknown) => ({
        text: answer,
        finishReason: 'stop',
        usage: { outputTokens: 20 },
    }));
    const llm = { canGenerate: () => true, explainGenerator: () => 'ready', converse } as unknown as LlmService;

    return { writer: new ModelWeatherBreakWriter(llm, config(values), logger), converse };
}

/** The system turn as the model was shown it, which is where the rules live. */
const systemTurn = (converse: ReturnType<typeof build>['converse']): string =>
    String((converse.mock.calls[0]?.[0].messages ?? []).find(message => message.role === 'system')?.content ?? '');

/** The user turn, which is where the substrate lives: the reading, the record coming up, the moment. */
const userTurn = (converse: ReturnType<typeof build>['converse']): string =>
    String((converse.mock.calls[0]?.[0].messages ?? []).find(message => message.role === 'user')?.content ?? '');

beforeEach(() => vi.clearAllMocks());

describe('when it will not even ask', () => {
    it('declines with no reading, rather than having a model invent a forecast', async () => {
        const { writer, converse } = build("It's seventeen and wet.");

        expect(await writer.write(request({ weather: undefined }))).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when the operator has not turned the model writer on', async () => {
        const { writer, converse } = build("It's 17 and wet.", {});

        expect(await writer.write(request())).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when the setting holds the STRING a settings row stores', async () => {
        // `deadair.settings` hands back `'false'`, which is truthy.
        const { writer, converse } = build("It's 17 and wet.", { [MODEL_WRITER_KEYS.enabled]: 'false' });

        expect(await writer.write(request())).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });
});

describe('what the model is shown', () => {
    it('is given the figures, with their units named once', async () => {
        const { writer, converse } = build("It's 17 and raining in Atlanta.");

        await writer.write(request());

        const shown = userTurn(converse);
        expect(shown).toContain('Atlanta');
        expect(shown).toContain('Celsius');
        expect(shown).toContain('- Temperature: 17');
        expect(shown).toContain('- Today: clear, high 24, low 12, 40% chance of rain');
    });

    it('names the days as today and tomorrow rather than by date', async () => {
        // A model handed `2026-08-31` reads the date out.
        const week: SpokenWeather = {
            ...READING,
            days: [
                { date: '2026-08-29', condition: 'clear', words: 'clear', high: 24 },
                { date: '2026-08-30', condition: 'rain', words: 'raining', high: 19 },
            ],
        };
        const { writer, converse } = build("It's 17 and raining.");

        await writer.write(request({ weather: week }));

        const shown = userTurn(converse);
        expect(shown).toContain('- Today:');
        expect(shown).toContain('- Tomorrow:');
    });

    it('leaves a measurement the service never sent off the list entirely', async () => {
        // A model given "Wind: —" fills it in.
        const thin: SpokenWeather = { ...READING, current: { condition: 'fog', words: 'foggy' }, days: [] };
        const { writer, converse } = build("It's foggy in Atlanta.");

        await writer.write(request({ weather: thin }));

        expect(userTurn(converse)).not.toContain('Temperature:');
    });

    it('forbids comparing it to anything, which is the sentence a model reaches for', async () => {
        const { writer, converse } = build("It's 17 and raining.");

        await writer.write(request());

        expect(systemTurn(converse)).toMatch(/yesterday/i);
    });

    it('is given no tools, so it cannot report a reading the floor would contradict', async () => {
        const { writer, converse } = build("It's 17 and raining.");

        await writer.write(request());

        expect(converse.mock.calls[0]?.[1]).toMatchObject({ tools: false });
    });
});

describe('a figure nobody measured', () => {
    it('refuses a script naming a temperature the station was never given', async () => {
        // The check that exists nowhere else in the station. 22 is plausible and false.
        const { writer } = build("It's 22 degrees and raining in Atlanta.");

        expect(await writer.write(request())).toBeUndefined();
    });

    it('says so on the row, so the record can name what happened', async () => {
        const { writer } = build("It's 22 degrees and raining in Atlanta.");

        await writer.write(request());

        expect(writer.detailOfLastWrite()?.reason).toMatch(/never given/);
    });

    it('airs a script that says only figures it was given', async () => {
        const { writer } = build("It's 17 and raining in Atlanta, getting up to 24 later.");

        const written = await writer.write(request());

        expect(written?.script).toContain('17');
        expect(written?.label).toBe('Weather');
    });
});

describe('inventedFigure', () => {
    it('permits every figure in the reading, not only the ones the prompt emphasised', () => {
        // A model that mentioned the humidity has said something true, and refusing it would push it
        // toward saying less than it knows.
        expect(inventedFigure('17 degrees, wind 20, humidity 72, high 24, low 12, 40 per cent chance.', READING)).toBeUndefined();
    });

    it('names the first figure that was not measured', () => {
        expect(inventedFigure("It's 17 now and 31 by the weekend.", READING)).toBe('31');
    });

    it('lets a spelled-out number through, which is the gap it deliberately has', () => {
        // Catching the spelled-out form would mean a number vocabulary in eleven languages to catch
        // a shape no model actually produces. Stated as a test so it is a decision rather than a bug.
        expect(inventedFigure("It's thirty-one degrees out there.", READING)).toBeUndefined();
    });

    it('is not fooled by a clock time, a date or a year', () => {
        // None of those is a measurement, and all three turn up in ordinary speech about the weather.
        expect(inventedFigure('Sunrise was at 6:07 this morning.', READING)).toBeUndefined();
        expect(inventedFigure('On the 31st it was much the same.', READING)).toBeUndefined();
        expect(inventedFigure('The wettest August since 2019.', READING)).toBeUndefined();
    });

    it('matches a figure the model rounded, since a rounded true figure is still true', () => {
        const fractional: SpokenWeather = { ...READING, current: { condition: 'rain', words: 'raining', temperature: 17 } };
        expect(inventedFigure("It's 17 degrees.", fractional)).toBeUndefined();
    });

    it('passes a script with no figures in it at all', () => {
        expect(inventedFigure("It's raining in Atlanta and it does not look like stopping.", READING)).toBeUndefined();
    });
});

describe('what it produces', () => {
    it('names the location in the label when a band asked for one', async () => {
        const { writer } = build("It's 17 and raining.");

        const written = await writer.write(request({ subject: { key: 'town', label: 'town' } }));

        expect(written?.label).toBe('Weather: town');
    });

    it('assumes it named the record coming up, which is the safe direction', async () => {
        const { writer } = build("It's 17 and raining. Now, John Martyn.");

        const written = await writer.write(request({ next: { title: 'Solid Air', artist: 'John Martyn' } }));

        expect(written?.claimsNext).toBe(true);
    });

    it('declines an answer that ran past the ceiling with no sentence to cut at', async () => {
        const { writer } = build(`${'weather '.repeat(WEATHER_MAX_WORDS + 20).trim()}`);

        expect(await writer.write(request())).toBeUndefined();
    });

    it("stamps the source's expiry rather than one of its own", async () => {
        // The same number the floor beneath it would stamp, which is the point of it coming from
        // `WeatherSource`: one observation cannot have two shelf lives depending on who wrote it up.
        const { writer } = build("It's 17 and raining.");

        const written = await writer.write(request({ weatherFreshUntil: 1_800_000 }));

        expect(written?.claimsReadingUntil).toBe(1_800_000);
    });

    it('stamps it even when the answer named no time and claimed no record', async () => {
        // Unconditional where `claimsTime` is answered: `WEATHER_SHAPE` exists to make the model
        // state this reading, and `inventedFigure` has just refused every number that was not in it.
        const { writer } = build("It's raining.");

        const written = await writer.write(request({ weatherFreshUntil: 1_800_000 }));

        expect(written?.claimsTime).toBeUndefined();
        expect(written?.claimsReadingUntil).toBe(1_800_000);
    });
});
