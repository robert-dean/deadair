// The charts page is the one surface in this console that changes nothing. What is worth pinning is
// that it says so: it offers a search rather than a claim about ownership, because a chart entry is
// strings and the contract carries no catalog id, and an empty edition is an ordinary answer rather
// than a fault.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ChartPage, StationChart } from '@deadair/sdk';

import { ChartsPage } from '../../../src/components/charts/charts.page';
import { render, screen, setupUser } from '../../utils/render';

const listCharts = vi.fn();
const readChart = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        charts: {
            listCharts: (...args: unknown[]) => listCharts(...args),
            readChart: (...args: unknown[]) => readChart(...args),
        },
    },
}));

// A real Link wants a router context this render helper deliberately does not build. The href is
// composed so the case below can say where "find in catalog" actually goes.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, search, children, ...rest }: { to: string; search?: Record<string, string>; children?: ReactNode }) => (
        <a href={search === undefined ? to : `${to}?${new URLSearchParams(search).toString()}`} {...rest}>
            {children}
        </a>
    ),
}));

const chart = (over: Partial<StationChart> = {}): StationChart => ({
    id: 'deadair.lastfm:top-tracks',
    pluginId: 'deadair.lastfm',
    name: 'Top Tracks',
    ...over,
});

const page = (over: Partial<ChartPage> = {}): ChartPage => ({
    chartId: 'deadair.lastfm:top-tracks',
    records: [{ rank: 1, title: 'Vaka', artist: 'Sigur Rós', peak: 1, weeksOn: 12 }],
    ...over,
});

afterEach(() => {
    vi.resetAllMocks();
});

describe('ChartsPage', () => {
    it('shows the first chart without making anybody choose one', async () => {
        listCharts.mockResolvedValue({ charts: [chart()] });
        readChart.mockResolvedValue(page());

        render(<ChartsPage />);

        expect(await screen.findByText('Vaka')).toBeInTheDocument();
        expect(readChart).toHaveBeenCalledWith('deadair.lastfm:top-tracks', {});
    });

    /**
     * The contract carries no catalog id and deliberately should not: a chart entry is a name, and
     * everything that would turn one into a record the station owns sits downstream of it. So the
     * row asks the question rather than answering it.
     */
    it('offers a catalog search rather than claiming the station has the record', async () => {
        listCharts.mockResolvedValue({ charts: [chart()] });
        readChart.mockResolvedValue(page());

        render(<ChartsPage />);

        const link = await screen.findByRole('link', { name: 'Find in catalog' });
        expect(link).toHaveAttribute('href', '/catalog/tracks?search=Vaka');
    });

    it('reads a chart the operator picks instead of the first one', async () => {
        listCharts.mockResolvedValue({ charts: [chart(), chart({ id: 'deadair.lastfm:uk', name: 'UK', country: 'GB' })] });
        readChart.mockResolvedValue(page());

        render(<ChartsPage />);
        await screen.findByText('Vaka');

        // The country distinguishes two charts one plugin offers under similar names.
        const user = setupUser();
        await user.click(screen.getByRole('combobox', { name: 'Chart' }));
        await user.click(await screen.findByText('UK (GB)'));

        expect(readChart).toHaveBeenCalledWith('deadair.lastfm:uk', {});
    });

    /** An empty chart is a 200 on the contract's own rule, so it must not be drawn as a fault. */
    it('treats an edition with nothing in it as ordinary rather than broken', async () => {
        listCharts.mockResolvedValue({ charts: [chart()] });
        readChart.mockResolvedValue(page({ records: [] }));

        render(<ChartsPage />);

        expect(await screen.findByText('Nothing in this edition')).toBeInTheDocument();
    });

    it('says what to do when no plugin offers one at all', async () => {
        listCharts.mockResolvedValue({ charts: [] });

        render(<ChartsPage />);

        expect(await screen.findByText('No plugin offers a chart')).toBeInTheDocument();
        expect(readChart).not.toHaveBeenCalled();
    });
});
