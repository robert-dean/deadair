// Asking what happened on the station's own date: the first plugin that answers winning outright, a
// source that answered about another day being dropped, and the lean happening here so the tool and
// the break writer cannot disagree about it. No HTTP — the service takes an instant and answers with
// entries, which is the path both callers drive.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import { PluginError, type AlmanacDay, type PluginManifest } from '@deadair/plugin-sdk';

import { AlmanacService } from '../../../src/modules/almanac/almanac.service.js';
import { ALMANAC_KEYS } from '../../../src/modules/almanac/almanac.keys.js';
import { CLOCK_KEYS } from '../../../src/modules/director/clock.words.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const ALPHA = 'deadair.alpha';
const BETA = 'deadair.beta';

/** Afternoon in London on the 20th of September, which is the 21st in Auckland. */
const AFTERNOON = new Date('2026-09-20T14:00:00Z').getTime();

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

/**
 * A config that answers with STRINGS, which is what every layer of `AppConfig`
 * actually holds. A double handing back a real enum would prove nothing about
 * `parseLean`.
 */
const stubConfig = (rows: Record<string, string> = {}): AppConfig =>
    ({ get: (key: string, fallback?: unknown) => rows[key] ?? fallback }) as unknown as AppConfig;

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        capabilities: ['almanac'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

const day = (date: string, texts: string[]): AlmanacDay => ({
    date,
    entries: texts.map((text, index) => ({ kind: 'birth', year: 1900 + index, text })),
});

function record(id: string, getDay: unknown, overrides: Partial<PluginRecord> = {}): PluginRecord {
    return {
        id,
        dir: `/plugins/${id}`,
        origin: 'bundled',
        status: 'active',
        manifest: manifest(id),
        instance: { init: vi.fn(), getDay } as never,
        ...overrides,
    };
}

const build = (records: PluginRecord[], rows: Record<string, string> = {}): AlmanacService => {
    const registry = new PluginRegistry();
    registry.setAll(records);
    return new AlmanacService(
        registry,
        new PluginInvoker(registry, stubPluginLog().log),
        stubConfig({ [CLOCK_KEYS.timezone]: 'UTC', ...rows }),
        stubLogger(),
    );
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('what the station can answer at all', () => {
    it('answers with nothing, and asks nobody, when no almanac plugin is installed', async () => {
        const service = build([]);

        expect(service.hasAlmanac()).toBe(false);
        await expect(service.read(AFTERNOON)).resolves.toBeUndefined();
    });

    it('does not count a plugin that declares the capability and never wrote the method', () => {
        expect(build([record(ALPHA, undefined)]).hasAlmanac()).toBe(false);
    });

    it('does not count a plugin that is not active', () => {
        expect(build([record(ALPHA, vi.fn(), { status: 'disabled' })]).hasAlmanac()).toBe(false);
    });
});

describe('which day is asked about', () => {
    it("is the station's own, in the station's zone", async () => {
        const asked = vi.fn(async () => day('09-21', ['Somebody, American singer']));
        const service = build([record(ALPHA, asked)], { [CLOCK_KEYS.timezone]: 'Pacific/Auckland' });

        await service.read(AFTERNOON);

        expect(asked).toHaveBeenCalledWith({ month: 9, day: 21 });
    });

    it('is the day the words will be heard, not the day they are written on', async () => {
        const asked = vi.fn(async () => day('09-21', ['Somebody, American singer']));
        const service = build([record(ALPHA, asked)]);

        await service.read(new Date('2026-09-21T00:05:00Z').getTime());

        expect(asked).toHaveBeenCalledWith({ month: 9, day: 21 });
    });

    it('comes back with the window the words stay true in', async () => {
        const service = build([
            record(
                ALPHA,
                vi.fn(async () => day('09-20', ['Somebody, American singer'])),
            ),
        ]);

        const answer = await service.read(AFTERNOON);

        expect(answer?.day.from).toBe(new Date('2026-09-20T00:00:00Z').getTime());
        expect(answer?.day.until).toBe(new Date('2026-09-21T00:00:00Z').getTime());
    });

    it('names the kinds a caller asked for, and nothing when it asked for none', async () => {
        const asked = vi.fn(async () => day('09-20', ['Somebody, American singer']));
        const service = build([record(ALPHA, asked)]);

        await service.read(AFTERNOON, { kinds: ['birth', 'death'] });
        expect(asked).toHaveBeenCalledWith({ month: 9, day: 20, kinds: ['birth', 'death'] });

        await service.read(AFTERNOON, { kinds: [] });
        expect(asked).toHaveBeenLastCalledWith({ month: 9, day: 20 });
    });

    it('asks for the day uncapped, because the lean needs the whole of it', async () => {
        // The four musicians in a day live among two hundred birthdays: a limit applied upstream
        // cuts them away before anything can prefer them.
        const asked = vi.fn(async () => day('09-20', ['Somebody, American singer']));
        const service = build([record(ALPHA, asked)]);

        await service.read(AFTERNOON, { limit: 2 });

        expect(asked).toHaveBeenCalledWith({ month: 9, day: 20 });
    });
});

describe('several sources', () => {
    it('takes the first that answers and asks nobody else', async () => {
        // Two almanacs asked about one date overlap rather than disagreeing, so a merge would read
        // the day out with its best lines duplicated.
        const first = vi.fn(async () => day('09-20', ['Somebody, American singer']));
        const second = vi.fn(async () => day('09-20', ['Somebody else, American singer']));
        const service = build([record(ALPHA, first), record(BETA, second)]);

        const answer = await service.read(AFTERNOON);

        expect(answer?.entries).toHaveLength(1);
        expect(second).not.toHaveBeenCalled();
    });

    it('asks the next when the first has nothing', async () => {
        const first = vi.fn(async () => undefined);
        const second = vi.fn(async () => day('09-20', ['Somebody else, American singer']));
        const service = build([record(ALPHA, first), record(BETA, second)]);

        expect((await service.read(AFTERNOON))?.entries[0]?.text).toContain('Somebody else');
    });

    it('costs the day rather than the request when a source throws', async () => {
        const failing = vi.fn(async () => {
            throw new PluginError('the service is down');
        });
        const service = build([
            record(ALPHA, failing),
            record(
                BETA,
                vi.fn(async () => day('09-20', ['Somebody, American singer'])),
            ),
        ]);

        await expect(service.read(AFTERNOON)).resolves.toMatchObject({ entries: [{ text: 'Somebody, American singer' }] });
    });
});

describe('an answer that cannot be trusted', () => {
    it('is dropped when it is about another day', async () => {
        // The date is echoed back so a plugin that quietly read its own clock can be caught, and
        // yesterday's anniversaries read as today's would sound exactly right.
        const asked = vi.fn(async () => day('09-19', ['Somebody, American singer']));
        const service = build([record(ALPHA, asked)]);

        await expect(service.read(AFTERNOON)).resolves.toBeUndefined();
    });

    it('is dropped when every entry it carries is empty', async () => {
        const asked = vi.fn(async () => ({ date: '09-20', entries: [{ kind: 'birth' as const, text: '  ' }] }));
        const service = build([record(ALPHA, asked)]);

        await expect(service.read(AFTERNOON)).resolves.toBeUndefined();
    });
});

describe('the lean', () => {
    const mixed = (): AlmanacDay => ({
        date: '09-20',
        entries: [
            { kind: 'event', year: 1801, text: 'A treaty was signed.' },
            { kind: 'birth', year: 1966, text: 'Nuno Bettencourt, Portuguese guitarist' },
        ],
    });

    it('happens here, so the tool and the break writer cannot differ about it', async () => {
        const service = build([
            record(
                ALPHA,
                vi.fn(async () => mixed()),
            ),
        ]);

        expect((await service.read(AFTERNOON))?.entries.map(item => item.year)).toEqual([1966, 1801]);
    });

    it("is the operator's, read as the string the settings table holds", async () => {
        const service = build(
            [
                record(
                    ALPHA,
                    vi.fn(async () => mixed()),
                ),
            ],
            { [ALMANAC_KEYS.lean]: 'any' },
        );

        expect((await service.read(AFTERNOON))?.entries.map(item => item.year)).toEqual([1801, 1966]);
    });

    it('can leave a thin day with nothing to say, which is an answer rather than a fault', async () => {
        const general = (): AlmanacDay => ({ date: '09-20', entries: [{ kind: 'event', year: 1801, text: 'A treaty was signed.' }] });
        const service = build(
            [
                record(
                    ALPHA,
                    vi.fn(async () => general()),
                ),
            ],
            { [ALMANAC_KEYS.lean]: 'musicOnly' },
        );

        await expect(service.read(AFTERNOON)).resolves.toBeUndefined();
    });

    it('takes the head of the leaned list when a caller capped it', async () => {
        const service = build([
            record(
                ALPHA,
                vi.fn(async () => mixed()),
            ),
        ]);

        expect((await service.read(AFTERNOON, { limit: 1 }))?.entries.map(item => item.year)).toEqual([1966]);
    });

    it('is not applied by the unleaned read, which answers as the source published', async () => {
        const service = build([
            record(
                ALPHA,
                vi.fn(async () => mixed()),
            ),
        ]);

        const asPublished = await service.day(service.dayFor(AFTERNOON));

        expect(asPublished?.entries.map(item => item.year)).toEqual([1801, 1966]);
    });
});
