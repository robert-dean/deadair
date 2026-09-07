// The slow half of airing a chart, moved off the request that asked for it. This job composes
// nothing itself — `putOnAir` is where a broadcast's binding is built and a second one here would be
// a second idea of what a broadcast is — so what is worth pinning is the delegation, the order of
// the two calls, and that a payload it cannot act on stops rather than throwing into a retry it does
// not have.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import type { JobContext } from '@maroonedsoftware/jobbroker';

import { AirChartJob } from '../../../src/modules/director/air.chart.job.js';
import type { DirectorConsoleService } from '../../../src/modules/director/director.console.service.js';
import type { PlayoutPusher } from '../../../src/modules/playout/playout.pusher.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
const context = { id: 'job-1' } as unknown as JobContext;
const container = {} as unknown as Container;

function build() {
    // Recorded in one list so the ORDER can be asserted: reconciling before the order exists would
    // hand the player the outgoing programme's tail and call it the changeover.
    const calls: string[] = [];
    const putOnAir = vi.fn(async () => {
        calls.push('putOnAir');
        return undefined;
    });
    const reconcile = vi.fn(async () => {
        calls.push('reconcile');
    });

    const console = { putOnAir } as unknown as DirectorConsoleService;
    const pusher = { reconcile } as unknown as PlayoutPusher;

    return { job: new AirChartJob(console, pusher, context, container, logger), putOnAir, reconcile, calls };
}

describe('AirChartJob', () => {
    it('hands the chart to putOnAir rather than building a broadcast of its own', async () => {
        const { job, putOnAir } = build();

        await job.run({ chartId: 'deadair.lastfm:top-100', chartOrder: 'ranked' });

        expect(putOnAir).toHaveBeenCalledWith({ chartId: 'deadair.lastfm:top-100', chartOrder: 'ranked' });
    });

    it('leaves the order out when the operator picked none, so the default is decided in one place', async () => {
        // `DEFAULT_CHART_ORDER` lives in `chart.picks.ts`. Filling it in here would be a second
        // place for it to be, and the two would drift.
        const { job, putOnAir } = build();

        await job.run({ chartId: 'deadair.lastfm:top-100' });

        expect(putOnAir).toHaveBeenCalledWith({ chartId: 'deadair.lastfm:top-100' });
    });

    it('hands the first item over only once there is an order to hand over', async () => {
        const { job, calls } = build();

        await job.run({ chartId: 'deadair.lastfm:top-100' });

        expect(calls).toEqual(['putOnAir', 'reconcile']);
    });

    it('says so and stops when the payload names no chart', async () => {
        // Only reachable by hand: the one sender builds this from an id `readChart` has already
        // validated. Throwing would spend a retry this job does not have on a payload that cannot
        // improve.
        const { job, putOnAir, reconcile } = build();

        await expect(job.run({})).resolves.toBeUndefined();

        expect(putOnAir).not.toHaveBeenCalled();
        expect(reconcile).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no chart on it'));
    });

    it('lets a failure out, since the operator is told through the feed rather than by this job', async () => {
        // "Nothing on that chart can be played" is a 422 out of `putOnAir` that no longer has a
        // request to land on. Swallowing it here would file the job as having succeeded.
        const { job, putOnAir, reconcile } = build();
        putOnAir.mockRejectedValueOnce(new Error('nothing on that chart can be played'));

        await expect(job.run({ chartId: 'deadair.lastfm:top-100' })).rejects.toThrow(/nothing on that chart/);
        // And the changeover is not announced over a broadcast that never started.
        expect(reconcile).not.toHaveBeenCalled();
    });
});
