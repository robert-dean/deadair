// Asking what it is like outside: the station's own place as the default, the
// first plugin that answers winning outright, and a service that failed costing
// the reading rather than the request. No HTTP here — `WeatherService` takes a
// place and answers with a reading, which is the same path the tool and the
// break writer both drive.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import { PluginError, type PluginManifest, type WeatherReading } from '@deadair/plugin-sdk';

import { WeatherService } from '../../../src/modules/weather/weather.service.js';
import { WEATHER_KEYS } from '../../../src/modules/weather/weather.keys.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const ALPHA = 'deadair.alpha';
const BETA = 'deadair.beta';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

/**
 * A config that answers with STRINGS, which is what every layer of `AppConfig`
 * actually holds. A double that handed back a real enum would prove nothing
 * about `parseUnits`.
 */
const stubConfig = (rows: Record<string, string> = {}): AppConfig =>
    ({ get: (key: string, fallback?: unknown) => rows[key] ?? fallback }) as unknown as AppConfig;

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        capabilities: ['weather'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

const reading = (place: string, temperatureC = 17): WeatherReading => ({
    place,
    observedAt: '2026-08-29T09:00:00-04:00',
    current: { condition: 'rain', temperatureC },
});

function record(id: string, getWeather: unknown, overrides: Partial<PluginRecord> = {}): PluginRecord {
    return {
        id,
        dir: `/plugins/${id}`,
        origin: 'bundled',
        status: 'active',
        manifest: manifest(id),
        instance: { init: vi.fn(), getWeather } as never,
        ...overrides,
    };
}

const build = (records: PluginRecord[], rows: Record<string, string> = {}): WeatherService => {
    const registry = new PluginRegistry();
    registry.setAll(records);
    return new WeatherService(registry, new PluginInvoker(registry, stubPluginLog().log), stubConfig(rows), stubLogger());
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('what the station can answer at all', () => {
    it('answers with nothing, and asks nobody, when no weather plugin is installed', async () => {
        const service = build([], { [WEATHER_KEYS.location]: 'Atlanta' });

        expect(service.hasWeather()).toBe(false);
        await expect(service.read()).resolves.toBeUndefined();
    });

    it('does not count a plugin that declares weather and never wrote the method', () => {
        expect(build([record(ALPHA, undefined)]).hasWeather()).toBe(false);
    });

    it('does not count a plugin that is not active', () => {
        const asked = vi.fn();
        expect(build([record(ALPHA, asked, { status: 'disabled' })]).hasWeather()).toBe(false);
    });
});

describe('where the station is', () => {
    it('asks about its own place when nobody named one', async () => {
        const asked = vi.fn(async () => reading('Atlanta, Georgia'));
        const service = build([record(ALPHA, asked)], { [WEATHER_KEYS.location]: 'Atlanta' });

        const answer = await service.read();

        expect(asked).toHaveBeenCalledWith({ place: 'Atlanta' });
        expect(answer?.place).toBe('Atlanta, Georgia');
    });

    it('asks about somewhere else when a caller names one', async () => {
        const asked = vi.fn(async () => reading('Chipping Norton'));
        const service = build([record(ALPHA, asked)], { [WEATHER_KEYS.location]: 'Atlanta' });

        await service.read('Chipping Norton');

        expect(asked).toHaveBeenCalledWith({ place: 'Chipping Norton' });
    });

    it('asks nobody, and guesses nothing, when the station has named no place', async () => {
        // A station guessing where it is would be worse than silent, because it
        // would sound right.
        const asked = vi.fn(async () => reading('Somewhere'));
        const service = build([record(ALPHA, asked)]);

        expect(service.home()).toBeUndefined();
        await expect(service.read()).resolves.toBeUndefined();
        expect(asked).not.toHaveBeenCalled();
    });

    it('treats a place of nothing but spaces as no place at all', async () => {
        const service = build([record(ALPHA, vi.fn())], { [WEATHER_KEYS.location]: '   ' });
        expect(service.home()).toBeUndefined();
    });
});

describe('the forecast', () => {
    it('asks for days only when a caller wanted any', async () => {
        const asked = vi.fn(async () => reading('Atlanta'));
        const service = build([record(ALPHA, asked)], { [WEATHER_KEYS.location]: 'Atlanta' });

        await service.read(undefined, 0);
        expect(asked).toHaveBeenLastCalledWith({ place: 'Atlanta' });

        await service.read(undefined, 3);
        expect(asked).toHaveBeenLastCalledWith({ place: 'Atlanta', days: 3 });
    });
});

describe('several plugins', () => {
    it('takes the first that answers and does not ask the rest', async () => {
        // Two services asked what it is like in one place give two readings of
        // the same sky. Averaging them would broadcast a temperature nobody
        // measured; listing them would ask a presenter to choose.
        const first = vi.fn(async () => reading('Atlanta', 17));
        const second = vi.fn(async () => reading('Atlanta', 21));
        const service = build([record(ALPHA, first), record(BETA, second)], { [WEATHER_KEYS.location]: 'Atlanta' });

        const answer = await service.read();

        expect(answer?.current.temperature).toBe(17);
        expect(second).not.toHaveBeenCalled();
    });

    it('falls through to the next when the first has nothing', async () => {
        const first = vi.fn(async () => undefined);
        const second = vi.fn(async () => reading('Atlanta', 21));
        const service = build([record(ALPHA, first), record(BETA, second)], { [WEATHER_KEYS.location]: 'Atlanta' });

        expect((await service.read())?.current.temperature).toBe(21);
    });

    it('falls through when the first THREW, since a service being down is not an answer', async () => {
        const first = vi.fn(async () => {
            throw new PluginError('the service is down').withCode('upstream');
        });
        const second = vi.fn(async () => reading('Atlanta', 21));
        const service = build([record(ALPHA, first), record(BETA, second)], { [WEATHER_KEYS.location]: 'Atlanta' });

        expect((await service.read())?.current.temperature).toBe(21);
    });
});

describe('a plugin that cannot answer', () => {
    it('costs the reading and not the request', async () => {
        const service = build(
            [
                record(
                    ALPHA,
                    vi.fn(async () => {
                        throw new PluginError('rate limited').withCode('rate_limited');
                    }),
                ),
            ],
            { [WEATHER_KEYS.location]: 'Atlanta' },
        );

        await expect(service.read()).resolves.toBeUndefined();
    });

    it('drops a reading with no place on it rather than passing on a hole', async () => {
        // The place is what a presenter says out loud, and the only evidence
        // anybody has that the right town was found.
        const service = build(
            [
                record(
                    ALPHA,
                    vi.fn(async () => ({ place: '  ', observedAt: '2026-08-29T09:00:00Z', current: { condition: 'clear' } })),
                ),
            ],
            {
                [WEATHER_KEYS.location]: 'Atlanta',
            },
        );

        await expect(service.read()).resolves.toBeUndefined();
    });

    it('drops a reading with no observation time on it', async () => {
        const service = build(
            [
                record(
                    ALPHA,
                    vi.fn(async () => ({ place: 'Atlanta', observedAt: '', current: { condition: 'clear' } })),
                ),
            ],
            {
                [WEATHER_KEYS.location]: 'Atlanta',
            },
        );

        await expect(service.read()).resolves.toBeUndefined();
    });
});

describe('units', () => {
    it('reads the setting as the STRING it is stored as', async () => {
        const service = build(
            [
                record(
                    ALPHA,
                    vi.fn(async () => reading('Atlanta', 0)),
                ),
            ],
            {
                [WEATHER_KEYS.location]: 'Atlanta',
                [WEATHER_KEYS.units]: 'imperial',
            },
        );

        expect(service.units()).toBe('imperial');
        expect((await service.read())?.current.temperature).toBe(32);
    });

    it('takes the default for a value nobody can parse, rather than the other one', () => {
        // `settingIsOn`'s rule: a value nobody can parse is a setting nobody set.
        expect(build([], { [WEATHER_KEYS.units]: 'furlongs' }).units()).toBe('metric');
        expect(build([], {}).units()).toBe('metric');
    });
});

describe('reading, the unconverted half', () => {
    it('answers in the units the capability uses, for a caller with its own arithmetic', async () => {
        const service = build(
            [
                record(
                    ALPHA,
                    vi.fn(async () => reading('Atlanta', 17.4)),
                ),
            ],
            {
                [WEATHER_KEYS.location]: 'Atlanta',
                [WEATHER_KEYS.units]: 'imperial',
            },
        );

        // Not converted and not rounded: converting it back would be two
        // roundings, which is the whole reason this is a separate method.
        expect((await service.reading())?.current.temperatureC).toBe(17.4);
    });
});
