// The tool is an adapter over `ChartsService` and nothing else, so what is worth testing is the
// shape of what the model sees: that a station with no chart plugin is offered no tool at all
// rather than one that always answers "there are none", that calling it with no id is how the ids
// are discovered, and that a record comes back under its LEAD artist — which is the field every
// step downstream matches a pick on.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { ChartEntry } from '@deadair/plugin-sdk';

import type { ChartsService } from '../../../src/modules/charts/charts.service.js';
import { ChartsTool } from '../../../src/modules/llm/charts.tool.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const CHART = 'deadair.lastfm:top-100';

interface ServiceOptions {
    hasCharts?: boolean;
    charts?: { id: string; pluginId: string; name: string; country?: string; genre?: string }[];
    entries?: ChartEntry[];
}

function build(options: ServiceOptions = {}) {
    const listCharts = vi.fn(async () => options.charts ?? [{ id: CHART, pluginId: 'deadair.lastfm', name: 'Top 100', country: 'GB' }]);
    // The parameters are named even though the body ignores them: the assertions below read
    // `call[1]` off the mock, which is a zero-length tuple for a `vi.fn` that declared none.
    const fetchChart = vi.fn(async (_id: string, _limit: number, _date?: string): Promise<ChartEntry[]> => options.entries ?? []);
    const charts = {
        hasCharts: () => options.hasCharts ?? true,
        listCharts,
        fetchChart,
    } as unknown as ChartsService;

    return { tool: new ChartsTool(charts, logger), listCharts, fetchChart };
}

const only = async (tool: ChartsTool) => (await tool.tools())[0]!;

describe('what is offered', () => {
    it('offers nothing at all when no chart plugin is installed', async () => {
        // Not a tool that answers "there are no charts": that declaration is context spent
        // teaching the model about something that cannot help it.
        const { tool } = build({ hasCharts: false });
        expect(await tool.tools()).toEqual([]);
    });

    it('tells the model that calling it with no id is how the ids are found', async () => {
        // A model that has to guess an id guesses a chart NAME and gets nothing back.
        const { tool } = build();
        const declaration = (await only(tool)).declaration;

        expect(declaration.name).toBe('browse_charts');
        expect(declaration.description).toMatch(/no chartId/i);
        expect(declaration.parameters.required).toEqual([]);
    });
});

describe('browsing the menu', () => {
    it('lists the charts on offer when no id was given', async () => {
        const { tool, fetchChart } = build();

        expect(await (await only(tool)).run({})).toEqual({ charts: [{ id: CHART, name: 'Top 100', country: 'GB' }] });
        expect(fetchChart).not.toHaveBeenCalled();
    });

    it('does not show the model which plugin answered, which is nothing it can act on', async () => {
        const { tool } = build();
        const result = (await (await only(tool)).run({})) as { charts: Record<string, unknown>[] };

        expect(result.charts[0]).not.toHaveProperty('pluginId');
    });

    it('treats a blank id as no id, because a model filling every field sends one', async () => {
        const { tool, fetchChart } = build();

        await (await only(tool)).run({ chartId: '   ' });

        expect(fetchChart).not.toHaveBeenCalled();
    });
});

describe('reading one chart', () => {
    const entry: ChartEntry = {
        rank: 3,
        title: 'Under Pressure',
        artist: 'Queen',
        featuring: ['David Bowie'],
        album: 'Hot Space',
        year: 1981,
        peak: 1,
        weeksOn: 14,
    };

    it('answers with the records, keeping the lead artist and the other credits apart', async () => {
        // The correctness rule the two search tools carry: the model copies `artist` back
        // verbatim and the pick path matches on it alone, so a joined credit resolves to nothing.
        const { tool } = build({ entries: [entry] });

        const result = (await (await only(tool)).run({ chartId: CHART })) as { chartId: string; records: Record<string, unknown>[] };

        expect(result.chartId).toBe(CHART);
        expect(result.records[0]).toMatchObject({ rank: 3, title: 'Under Pressure', artist: 'Queen', featuring: ['David Bowie'] });
    });

    it('passes an edition through when the model asked for one', async () => {
        const { tool, fetchChart } = build();

        await (await only(tool)).run({ chartId: CHART, limit: 10, date: '1994-11-05' });

        expect(fetchChart).toHaveBeenCalledWith(CHART, 10, '1994-11-05');
    });

    it('clamps a limit the model invented, and falls back to the ceiling for nonsense', async () => {
        const { tool, fetchChart } = build();
        const run = (await only(tool)).run;

        await run({ chartId: CHART, limit: 500 });
        await run({ chartId: CHART, limit: 0 });
        await run({ chartId: CHART, limit: 'lots' });

        expect(fetchChart.mock.calls.map(call => call[1])).toEqual([25, 25, 25]);
    });

    it('answers with an empty list rather than failing when the chart could not be read', async () => {
        // The service has already flattened a dead upstream, an unknown plugin and an empty chart
        // into one outcome. A tool that threw here would end a generation over a chart.
        const { tool } = build({ entries: [] });

        expect(await (await only(tool)).run({ chartId: CHART })).toEqual({ chartId: CHART, records: [] });
    });
});
