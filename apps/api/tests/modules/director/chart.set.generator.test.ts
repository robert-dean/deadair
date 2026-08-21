// The binding that programmes from somebody else's ranking. What matters here is mostly what it
// REFUSES to do: nothing at all until an operator sets a mix, never more than its share of a batch,
// and no opinion of its own about what may air — every pick it names is judged by `PickResolver`
// like any other, which is what stops a chart from routing around a dislike.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { ChartEntry } from '@deadair/plugin-sdk';

import { CHART_GENERATOR_KEYS, ChartSetGenerator } from '../../../src/modules/director/chart.set.generator.js';
import type { ChartsService } from '../../../src/modules/charts/charts.service.js';
import { DEFAULT_RULES, type ResolvedRules } from '../../../src/modules/director/rotation.rules.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';
import type { SetInputs } from '../../../src/modules/director/set.generator.js';

const stubLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

const CHART = 'deadair.lastfm:top-100';
const rules: ResolvedRules = DEFAULT_RULES;

const entry = (rank: number, title: string, artist: string): ChartEntry => ({ rank, title, artist });

/** Ten records, so an oversampled fetch has something to be trimmed from. */
const TOP_TEN: ChartEntry[] = [
    entry(1, 'Glory Box', 'Portishead'),
    entry(2, 'Roads', 'Portishead'),
    entry(3, 'Windowlicker', 'Aphex Twin'),
    entry(4, 'Xtal', 'Aphex Twin'),
    entry(5, 'Teardrop', 'Massive Attack'),
    entry(6, 'Angel', 'Massive Attack'),
    entry(7, 'Rez', 'Underworld'),
    entry(8, 'Born Slippy', 'Underworld'),
    entry(9, 'Midnight', 'Boards of Canada'),
    entry(10, 'Roygbiv', 'Boards of Canada'),
];

interface Options {
    settings?: Record<string, unknown>;
    hasCharts?: boolean;
    charts?: { id: string; pluginId: string; name: string; country?: string; genre?: string }[];
    entries?: ChartEntry[];
}

function build(options: Options = {}) {
    const settings: Record<string, unknown> = { [CHART_GENERATOR_KEYS.mix]: 1, ...options.settings };
    const config = {
        get: vi.fn((key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback)),
    } as unknown as AppConfig;

    const listCharts = vi.fn(async () => options.charts ?? [{ id: CHART, pluginId: 'deadair.lastfm', name: 'Top 100', country: 'GB' }]);
    const fetchChart = vi.fn(async (_id: string, _limit: number, _date?: string): Promise<ChartEntry[]> => options.entries ?? TOP_TEN);
    const charts = { hasCharts: () => options.hasCharts ?? true, listCharts, fetchChart } as unknown as ChartsService;
    const logger = stubLogger();

    return { generator: new ChartSetGenerator(charts, config, logger as unknown as Logger), listCharts, fetchChart, logger };
}

const inputs = (overrides: Partial<SetInputs> = {}): SetInputs => ({ count: 4, rules, ...overrides });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('when it declines', () => {
    it('does nothing at all with the mix unset, so installing a plugin changes no hour', async () => {
        const { generator, fetchChart } = build({ settings: { [CHART_GENERATOR_KEYS.mix]: undefined } });

        expect(await generator.generate(inputs())).toEqual([]);
        expect(fetchChart).not.toHaveBeenCalled();
    });

    it.each([
        ['zero', 0],
        ['negative', -1],
        ['not a number', 'lots'],
    ])('treats a %s mix as off rather than asking for NaN records', async (_case, mix) => {
        const { generator, fetchChart } = build({ settings: { [CHART_GENERATOR_KEYS.mix]: mix } });

        expect(await generator.generate(inputs())).toEqual([]);
        expect(fetchChart).not.toHaveBeenCalled();
    });

    it('says once that an installed chart plugin is being asked for nothing', async () => {
        // The trap this closes: the console lists `charts` as a live capability of an active plugin
        // whether or not the station asks it for anything, and 0 is the DEFAULT here — so on any
        // station with a chart plugin installed, silence would be the normal state.
        const { generator, logger } = build({ settings: { [CHART_GENERATOR_KEYS.mix]: 0 } });

        await generator.generate(inputs());
        await generator.generate(inputs());

        expect(logger.info).toHaveBeenCalledOnce();
        expect(logger.info.mock.calls[0]![0]).toMatch(/rotation\.chartMix/);
    });

    it('stays silent about the mix when no plugin could have answered anyway', async () => {
        const { generator, logger } = build({ settings: { [CHART_GENERATOR_KEYS.mix]: 0 }, hasCharts: false });

        await generator.generate(inputs());

        expect(logger.info).not.toHaveBeenCalled();
    });

    it('declines quietly when no plugin can serve a chart', async () => {
        const { generator, fetchChart } = build({ hasCharts: false });

        expect(await generator.generate(inputs())).toEqual([]);
        expect(fetchChart).not.toHaveBeenCalled();
    });

    it('is asked for nothing when the chain has nothing left to fill', async () => {
        const { generator, fetchChart } = build();

        expect(await generator.generate(inputs({ count: 0 }))).toEqual([]);
        expect(fetchChart).not.toHaveBeenCalled();
    });
});

describe('taking its share', () => {
    it('names its fraction of the batch and no more', async () => {
        const { generator } = build({ settings: { [CHART_GENERATOR_KEYS.mix]: 0.5 } });

        expect(await generator.generate(inputs({ count: 8 }))).toHaveLength(4);
    });

    it('contributes at least one record for a mix an operator set above zero', async () => {
        // 0.1 of a four-record refill rounds to nothing, which would read as a chart that is
        // configured and does nothing.
        const { generator } = build({ settings: { [CHART_GENERATOR_KEYS.mix]: 0.1 } });

        expect(await generator.generate(inputs({ count: 4 }))).toHaveLength(1);
    });

    it('oversamples the fetch, because most of a chart is already queued or unplayable', async () => {
        const { generator, fetchChart } = build();

        await generator.generate(inputs({ count: 4 }));

        expect(fetchChart.mock.calls[0]![1]).toBeGreaterThan(4);
    });

    it('answers with names and never a catalog id, because it has not read the catalog', async () => {
        const { generator } = build({ settings: { [CHART_GENERATOR_KEYS.mix]: 0.25 } });

        const picks = await generator.generate(inputs({ count: 4 }));

        expect(picks[0]).toEqual({ title: 'Glory Box', artist: 'Portishead' });
        expect(picks[0]).not.toHaveProperty('trackId');
    });

    it('skips what the running order already holds and keeps going down the chart', async () => {
        // The reason the fetch is oversampled: a top ten against an order that holds half of it
        // should contribute the other half rather than stopping at a run of duplicates.
        const { generator } = build();
        const avoidSongKeys = new Set([songKey('Glory Box', ['Portishead']), songKey('Roads', ['Portishead'])]);

        const picks = await generator.generate(inputs({ count: 2, avoidSongKeys }));

        expect(picks.map(pick => pick.title)).toEqual(['Windowlicker', 'Xtal']);
    });

    it('names one record once, however often the chart lists it', async () => {
        const { generator } = build({ entries: [entry(1, 'Roads', 'Portishead'), entry(2, 'Roads', 'Portishead'), entry(3, 'Xtal', 'Aphex Twin')] });

        const picks = await generator.generate(inputs({ count: 3 }));

        expect(picks.map(pick => pick.title)).toEqual(['Roads', 'Xtal']);
    });

    it('answers with nothing when the chart came back empty, rather than failing a refill', async () => {
        const { generator } = build({ entries: [] });

        expect(await generator.generate(inputs())).toEqual([]);
    });
});

describe('choosing which chart', () => {
    it("reads the operator's chart without asking what else is on offer", async () => {
        const { generator, fetchChart, listCharts } = build({ settings: { [CHART_GENERATOR_KEYS.chart]: 'deadair.apple:most-played' } });

        await generator.generate(inputs());

        expect(fetchChart.mock.calls[0]![0]).toBe('deadair.apple:most-played');
        expect(listCharts).not.toHaveBeenCalled();
    });

    it('lets a brief pick between the charts on offer', async () => {
        const { generator, fetchChart } = build({
            charts: [
                { id: 'deadair.lastfm:global', pluginId: 'deadair.lastfm', name: 'Global' },
                { id: 'deadair.lastfm:rock', pluginId: 'deadair.lastfm', name: 'Rock', genre: 'rock' },
            ],
        });

        await generator.generate(inputs({ brief: 'a night of heavy rock' }));

        expect(fetchChart.mock.calls[0]![0]).toBe('deadair.lastfm:rock');
    });

    it('falls back to the first chart when the brief matches none, rather than filtering one', async () => {
        // The rule the deterministic layer lives by: approximating an instruction is not allowed,
        // so an unmatched brief changes which document is read and never what is taken from it.
        const { generator, fetchChart } = build({
            charts: [
                { id: 'deadair.lastfm:global', pluginId: 'deadair.lastfm', name: 'Global' },
                { id: 'deadair.lastfm:rock', pluginId: 'deadair.lastfm', name: 'Rock', genre: 'rock' },
            ],
        });

        const picks = await generator.generate(inputs({ brief: 'something for a rainy Tuesday' }));

        expect(fetchChart.mock.calls[0]![0]).toBe('deadair.lastfm:global');
        expect(picks.length).toBeGreaterThan(0);
    });

    it('declines when the menu is empty and nothing was configured', async () => {
        const { generator, fetchChart } = build({ charts: [] });

        expect(await generator.generate(inputs())).toEqual([]);
        expect(fetchChart).not.toHaveBeenCalled();
    });
});

describe('discovery', () => {
    it('says so once when the mix is set and discovery is off, which otherwise looks like a broken plugin', async () => {
        // Once per process rather than per refill: it is a configuration fact that will be just as
        // true on the next boundary, and a refill happens every few records.
        const { generator, logger } = build({ settings: { 'rotation.discover': false } });

        await generator.generate(inputs());
        await generator.generate(inputs());

        expect(logger.warn).toHaveBeenCalledOnce();
        expect(logger.warn.mock.calls[0]![0]).toMatch(/rotation\.discover/);
    });

    it('says nothing at all while discovery is on, which is the ordinary state', async () => {
        const { generator, logger } = build();

        await generator.generate(inputs());

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('still names records with discovery off, because the library may hold some of them', async () => {
        // Declining outright would be this binding deciding what may air, which is the resolver's
        // job. It warns and hands its picks over exactly as it would otherwise.
        const { generator } = build({ settings: { 'rotation.discover': false } });

        expect(await generator.generate(inputs({ count: 2 }))).toHaveLength(2);
    });

    describe('under a period', () => {
        it('names only the entries that fall inside it, and keeps an undated one', async () => {
            const { generator } = build({
                entries: [
                    { rank: 1, title: 'Now', artist: 'A', year: 2026 },
                    { rank: 2, title: 'Then', artist: 'B', year: 1975 },
                    { rank: 3, title: 'Undated', artist: 'C' },
                ],
            });

            const picks = await generator.generate(inputs({ count: 4, era: { from: 1970, to: 1979 } }));

            expect(picks.map(pick => pick.title)).toEqual(['Then', 'Undated']);
        });

        it('comes back empty against a current chart, which is the setting working', async () => {
            // Worth pinning rather than discovering on air: a chart is a snapshot of what is popular
            // NOW, so a station asked for a decade finds almost none of one eligible. An operator who
            // wants both wants a chart FROM that period, which is `rotation.chart`.
            const { generator } = build({ entries: [{ rank: 1, title: 'Now', artist: 'A', year: 2026 }] });

            expect(await generator.generate(inputs({ count: 4, era: { from: 1970, to: 1979 } }))).toEqual([]);
        });
    });
});
