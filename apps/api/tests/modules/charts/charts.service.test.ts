// The menu: every installed chart plugin asked what it offers, under ids that
// say which plugin offered them, with a failing plugin costing its own rows and
// nothing else. No HTTP here — `ChartsService` takes an id and answers with
// entries, which is the same path the tool, the generator and the route drive.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { PluginError, type ChartDescriptor, type ChartEntry, type PluginManifest } from '@deadair/plugin-sdk';

import { ChartsService, MAX_CHART_ENTRIES } from '../../../src/modules/charts/charts.service.js';
import { qualifyChartId, splitChartId } from '../../../src/modules/charts/chart.ids.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const LASTFM = 'deadair.lastfm';
const APPLE = 'deadair.apple';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        capabilities: ['charts'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
        ...overrides,
    };
}

const entry = (rank: number, title: string, artist: string): ChartEntry => ({ rank, title, artist });

interface InstanceOptions {
    listCharts?: unknown;
    fetchChart?: unknown;
}

function instance(options: InstanceOptions = {}) {
    const built: Record<string, unknown> = {
        init: vi.fn(),
        listCharts: options.listCharts ?? vi.fn(async (): Promise<ChartDescriptor[]> => [{ id: 'top-100', name: 'Top 100' }]),
        fetchChart: options.fetchChart ?? vi.fn(async (): Promise<ChartEntry[]> => [entry(1, 'Glory Box', 'Portishead')]),
    };
    return built;
}

function record(id: string, overrides: Partial<PluginRecord> = {}, options: InstanceOptions = {}): PluginRecord {
    return { id, dir: `/plugins/${id}`, status: 'active', manifest: manifest(id), instance: instance(options) as never, ...overrides };
}

const build = (records: PluginRecord[]): ChartsService => {
    const registry = new PluginRegistry();
    registry.setAll(records);
    return new ChartsService(registry, new PluginInvoker(registry, stubPluginLog().log), stubLogger());
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('chart ids', () => {
    it('round-trips a plugin id and a chart id', () => {
        expect(splitChartId(qualifyChartId(LASTFM, 'top-100'))).toEqual({ pluginId: LASTFM, chartId: 'top-100' });
    });

    it('splits at the FIRST colon, so a chart id may contain one', () => {
        expect(splitChartId(qualifyChartId(LASTFM, 'geo:gb'))).toEqual({ pluginId: LASTFM, chartId: 'geo:gb' });
    });

    it.each(['top-100', '', ':top-100', `${LASTFM}:`])('declines "%s", which names no plugin', qualified => {
        expect(splitChartId(qualified)).toBeUndefined();
    });
});

describe('listing what is on offer', () => {
    it('qualifies every id with the plugin that named it', async () => {
        const service = build([record(LASTFM)]);
        expect(await service.listCharts()).toEqual([{ id: `${LASTFM}:top-100`, pluginId: LASTFM, name: 'Top 100' }]);
    });

    it('keeps two plugins that both call a chart "top-100" apart', async () => {
        const service = build([record(LASTFM), record(APPLE)]);
        const ids = (await service.listCharts()).map(chart => chart.id);
        expect(ids).toEqual([`${APPLE}:top-100`, `${LASTFM}:top-100`]);
    });

    it("keeps the plugin's own order within a plugin, because that order is a decision", async () => {
        const listCharts = vi.fn(async (): Promise<ChartDescriptor[]> => [
            { id: 'z-global', name: 'Global' },
            { id: 'a-uk', name: 'United Kingdom' },
        ]);
        const service = build([record(LASTFM, {}, { listCharts })]);
        expect((await service.listCharts()).map(chart => chart.id)).toEqual([`${LASTFM}:z-global`, `${LASTFM}:a-uk`]);
    });

    it('loses one plugin to a failure and keeps the other', async () => {
        const listCharts = vi.fn(async () => {
            throw new PluginError('upstream is down').withCode('upstream');
        });
        const service = build([record(LASTFM, {}, { listCharts }), record(APPLE)]);
        expect((await service.listCharts()).map(chart => chart.pluginId)).toEqual([APPLE]);
    });

    it('ignores a plugin that is not running', async () => {
        const service = build([record(LASTFM, { status: 'failed', error: 'boom' })]);
        expect(await service.listCharts()).toEqual([]);
        expect(service.hasCharts()).toBe(false);
    });

    it('ignores a plugin that declares charts and only half implements them', async () => {
        const half = record(LASTFM);
        half.instance = { init: vi.fn(), fetchChart: vi.fn() } as never;
        const service = build([half]);
        expect(await service.listCharts()).toEqual([]);
    });

    it('drops a descriptor with no id or no name rather than offering one nothing can ask for', async () => {
        const listCharts = vi.fn(async () => [
            { id: '', name: 'Nameless' },
            { id: 'ok', name: '' },
            { id: 'fine', name: 'Fine' },
        ]);
        const service = build([record(LASTFM, {}, { listCharts })]);
        expect((await service.listCharts()).map(chart => chart.id)).toEqual([`${LASTFM}:fine`]);
    });
});

describe('fetching one', () => {
    it('asks the plugin the id names, with the chart id it knows itself', async () => {
        const fetchChart = vi.fn(async () => [entry(1, 'Glory Box', 'Portishead')]);
        const service = build([record(LASTFM, {}, { fetchChart }), record(APPLE)]);

        const entries = await service.fetchChart(`${LASTFM}:geo:gb`, 10, '1994-11-05');

        expect(fetchChart).toHaveBeenCalledWith({ chartId: 'geo:gb', limit: 10, date: '1994-11-05' });
        expect(entries).toEqual([entry(1, 'Glory Box', 'Portishead')]);
    });

    it('leaves `date` off entirely when none was asked for', async () => {
        const fetchChart = vi.fn(async () => []);
        const service = build([record(LASTFM, {}, { fetchChart })]);

        await service.fetchChart(`${LASTFM}:top-100`, 10);

        expect(fetchChart).toHaveBeenCalledWith({ chartId: 'top-100', limit: 10 });
    });

    it.each([
        ['an unqualified id', 'top-100'],
        ['a plugin that is not installed', 'deadair.nobody:top-100'],
    ])('answers with nothing for %s', async (_case, id) => {
        const service = build([record(LASTFM)]);
        expect(await service.fetchChart(id, 10)).toEqual([]);
    });

    it('answers with nothing when the plugin fails, rather than throwing at a refill', async () => {
        const fetchChart = vi.fn(async () => {
            throw new PluginError('upstream is down').withCode('upstream');
        });
        const service = build([record(LASTFM, {}, { fetchChart })]);
        expect(await service.fetchChart(`${LASTFM}:top-100`, 10)).toEqual([]);
    });

    it('drops an entry with no title or no artist, which nothing downstream could name', async () => {
        const fetchChart = vi.fn(async () => [entry(1, 'Glory Box', ' '), entry(2, '', 'Portishead'), entry(3, 'Roads', 'Portishead')]);
        const service = build([record(LASTFM, {}, { fetchChart })]);
        expect(await service.fetchChart(`${LASTFM}:top-100`, 10)).toEqual([entry(3, 'Roads', 'Portishead')]);
    });

    it("clamps the limit before it reaches somebody else's API", async () => {
        const fetchChart = vi.fn(async () => []);
        const service = build([record(LASTFM, {}, { fetchChart })]);

        await service.fetchChart(`${LASTFM}:top-100`, 5_000);

        expect(fetchChart).toHaveBeenCalledWith({ chartId: 'top-100', limit: MAX_CHART_ENTRIES });
    });

    it('trims a plugin that returned more than it was asked for', async () => {
        const fetchChart = vi.fn(async () => [entry(1, 'One', 'A'), entry(2, 'Two', 'B'), entry(3, 'Three', 'C')]);
        const service = build([record(LASTFM, {}, { fetchChart })]);
        expect(await service.fetchChart(`${LASTFM}:top-100`, 2)).toHaveLength(2);
    });
});
