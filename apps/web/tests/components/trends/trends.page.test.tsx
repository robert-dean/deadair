// Trends reads four sections, each from its own request, on Check-up's rule: one dead reader costs the
// page one section, never the screen. That, the empty state of a new install, and that each section
// asks for the metrics it draws, are what is pinned here; the charts themselves are recharts', drawn
// into a jsdom with no layout, so their marks are not.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { MetricSeriesPage } from '@deadair/sdk';

import { clearSession, setSession } from '../../../src/auth/session.store';
import { TrendsPage } from '../../../src/components/trends/trends.page';
import { render, screen } from '../../utils/render';

const readMetricSeries = vi.fn();
const readMetricNames = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { metrics: { readMetricSeries: (query: unknown) => readMetricSeries(query), readMetricNames: () => readMetricNames() } },
}));

const from = DateTime.fromISO('2026-10-17T00:00:00Z', { zone: 'utc' });
const page = (series: MetricSeriesPage['series']): MetricSeriesPage => ({ resolution: 'minute', from, to: from.plus({ hours: 24 }), series });
const point = (minutes: number, value: number) => ({ at: from.plus({ minutes }), count: 1, sum: value, min: value, max: value, last: value });

/** Answers each section with something drawable, keyed on the first metric it asks for. */
function allWell() {
    readMetricNames.mockResolvedValue({ names: [] });
    readMetricSeries.mockImplementation(async ({ names }: { names: string }) => {
        if (names.startsWith('station.listeners'))
            return page([{ name: 'station.listeners', labels: {}, source: 'station', points: [point(0, 9), point(1, 4)] }]);
        if (names.startsWith('work.job.ms'))
            return page([
                { name: 'work.job.ms', labels: { queue: 'catalog.sync' }, source: 'station', points: [point(0, 4000)] },
                { name: 'work.plugin.ms', labels: { plugin: 'spotify', op: 'search' }, source: 'station', points: [point(0, 40)] },
            ]);
        return page([{ name: names.split(',')[0] ?? '', labels: {}, source: 'station', points: [point(0, 1)] }]);
    });
}

beforeEach(() => setSession('token-123', 3600));
afterEach(() => {
    clearSession();
    vi.resetAllMocks();
});

describe('TrendsPage', () => {
    it('asks each section for the metrics it draws, over a range ending now', async () => {
        allWell();
        render(<TrendsPage />);

        await screen.findByText('catalog.sync');
        const asked = readMetricSeries.mock.calls.map(([query]) => (query as { names: string }).names);
        expect(asked).toEqual(
            expect.arrayContaining([
                'station.listeners',
                'model.tokens.input,model.tokens.output,model.call.ms,work.failed',
                'work.job.ms,work.plugin.ms,work.failed',
                'library.tracks,library.cached,library.measured,storage.bytes',
            ]),
        );
        const [{ from: askedFrom, to: askedTo }] = readMetricSeries.mock.calls[0] as [{ from: DateTime; to: DateTime }];
        expect(askedTo.diff(askedFrom, 'hours').hours).toBe(24);
    });

    it('draws the audience figures and ranks the work', async () => {
        allWell();
        render(<TrendsPage />);

        expect(await screen.findByText('Most at once')).toBeInTheDocument();
        // Now is the latest reading, the peak the largest, and the average across both.
        expect(screen.getByText('4')).toBeInTheDocument();
        expect(screen.getByText('9')).toBeInTheDocument();
        expect(screen.getByText('6.5')).toBeInTheDocument();
        expect(await screen.findByText('spotify · search')).toBeInTheDocument();
        // One run, so its average and its longest are the same four seconds.
        expect(screen.getAllByText('4.0s')).toHaveLength(2);
    });

    it('loses only the section whose reading failed', async () => {
        allWell();
        const answer = readMetricSeries.getMockImplementation();
        readMetricSeries.mockImplementation(async (query: { names: string }) => {
            if (query.names.startsWith('model.')) throw new Error('down');
            return answer?.(query);
        });
        render(<TrendsPage />);

        expect(await screen.findByText('This could not be read. The rest of the page still can.')).toBeInTheDocument();
        expect(await screen.findByText('catalog.sync')).toBeInTheDocument();
        expect(screen.getByText('Most at once')).toBeInTheDocument();
    });

    it('says a new install has nothing yet, rather than drawing empty axes', async () => {
        readMetricNames.mockResolvedValue({ names: [] });
        readMetricSeries.mockResolvedValue(page([]));
        render(<TrendsPage />);

        expect(await screen.findAllByText(/Nothing was measured in this range yet/)).toHaveLength(4);
    });

    it('draws nothing for received metrics until another service has sent some', async () => {
        allWell();
        render(<TrendsPage />);

        await screen.findByText('catalog.sync');
        expect(screen.queryByText('From your other services')).not.toBeInTheDocument();
    });

    it('draws the first metric another service sent, reading only the rows it sent', async () => {
        allWell();
        readMetricNames.mockResolvedValue({
            names: [
                { name: 'station.listeners', source: 'station', labelKeys: [], lastSeen: from },
                { name: 'queue.depth', source: 'otlp', labelKeys: ['service.name'], lastSeen: from },
            ],
        });
        render(<TrendsPage />);

        expect(await screen.findByText('From your other services')).toBeInTheDocument();
        // The select's own input and the hidden one it submits both hold the value.
        expect((await screen.findAllByDisplayValue('queue.depth')).length).toBeGreaterThan(0);
        expect(readMetricSeries.mock.calls.map(([query]) => (query as { names: string }).names)).toContain('queue.depth');
    });
});
