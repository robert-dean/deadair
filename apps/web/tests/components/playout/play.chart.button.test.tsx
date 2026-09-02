// The one control on this console that puts a station on somebody else's ranking. What is worth
// pinning is the shape of the request it sends — a countdown unless told otherwise, because that is
// the difference between a chart show and a chart — and that it declines to offer a broadcast the
// API would refuse.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlayChartButton } from '../../../src/components/playout/play.chart.button';
import { render, screen, setupUser } from '../../utils/render';

const playAChart = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playout: {
            playAChart: (...args: unknown[]) => playAChart(...args),
        },
    },
}));

const status = { active: true, items: [] };

afterEach(() => {
    vi.clearAllMocks();
});

describe('PlayChartButton', () => {
    it('airs the chart as a countdown when nobody says otherwise', async () => {
        playAChart.mockResolvedValue(status);
        const user = setupUser();
        render(<PlayChartButton chartId="deadair.lastfm:top-100" />);

        await user.click(screen.getByRole('button', { name: 'Air this chart' }));

        expect(playAChart).toHaveBeenCalledWith({ chartId: 'deadair.lastfm:top-100', chartOrder: 'countdown' });
    });

    it('sends the order the operator picked instead', async () => {
        playAChart.mockResolvedValue(status);
        const user = setupUser();
        render(<PlayChartButton chartId="deadair.lastfm:top-100" />);

        await user.click(screen.getByRole('combobox', { name: 'Which way round to play the chart' }));
        await user.click(await screen.findByText('Number one first'));
        await user.click(screen.getByRole('button', { name: 'Air this chart' }));

        expect(playAChart).toHaveBeenCalledWith({ chartId: 'deadair.lastfm:top-100', chartOrder: 'ranked' });
    });

    it('offers nothing for a chart that came back empty, since airing one is a refusal', async () => {
        render(<PlayChartButton chartId="deadair.lastfm:top-100" playable={false} />);

        expect(screen.queryByRole('button', { name: 'Air this chart' })).toBeNull();
    });

    it('keeps a refusal on the button rather than raising it over the page', async () => {
        playAChart.mockRejectedValue(Object.assign(new Error('Unprocessable'), { details: { message: 'that chart could not be read' } }));
        const user = setupUser();
        render(<PlayChartButton chartId="deadair.lastfm:top-100" />);

        await user.click(screen.getByRole('button', { name: 'Air this chart' }));

        expect(await screen.findByRole('button', { name: 'Failed' })).toBeVisible();
    });

    it('says what a chart costs that a playlist does not', async () => {
        // The one surprise in pressing this: a chart names records the library may never have held,
        // so they arrive unmeasured and air untrimmed until the analysis pass reaches them.
        render(<PlayChartButton chartId="deadair.lastfm:top-100" />);

        expect(screen.getByText(/air untrimmed until they have been measured/)).toBeVisible();
    });
});
