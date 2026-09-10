// The slow half of airing a chart, moved off the request that asked for it. This job composes
// nothing itself — `putOnAir` is where a broadcast's binding is built and a second one here would be
// a second idea of what a broadcast is — so what is worth pinning is the delegation, the order of
// the two calls, that a payload it cannot act on stops rather than throwing into a retry it does
// not have, and that a press whose broadcast has moved on since it was made is refused rather than
// ending whatever the station has gone on to since.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import type { JobContext } from '@maroonedsoftware/jobbroker';

import { AirChartJob } from '../../../src/modules/director/air.chart.job.js';
import type { DirectorConsoleService } from '../../../src/modules/director/director.console.service.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';
import type { PlayoutPusher } from '../../../src/modules/playout/playout.pusher.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
const context = { id: 'job-1' } as unknown as JobContext;
const container = {} as unknown as Container;

interface Options {
    /** The broadcast the station is actually on when the job runs. Absent is a station stood down. */
    broadcastId?: string;
}

function build(options: Options = {}) {
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
    const director = {
        order: vi.fn(() => (options.broadcastId === undefined ? undefined : { broadcastId: options.broadcastId })),
    } as unknown as DirectorService;
    const record = vi.fn(async () => {});
    const activity = { record } as unknown as ActivityRecorder;

    return {
        job: new AirChartJob(console, pusher, director, activity, context, container, logger),
        putOnAir,
        reconcile,
        calls,
        director,
        record,
    };
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

// A press is stamped with the broadcast the station was on when it happened, and this is where
// that gets checked against the broadcast actually on air by the time the job runs: a Stop, a
// changeover, or a station brought on air some other way in between all mean this press is no
// longer about anything the station is doing now.
describe('AirChartJob checking the broadcast a press was about', () => {
    it('refuses after a changeover, without ever calling putOnAir', async () => {
        const { job, putOnAir, reconcile, record } = build({ broadcastId: 'broadcast-2' });

        await job.run({ chartId: 'deadair.lastfm:top-100', broadcastId: 'broadcast-1' });

        expect(putOnAir).not.toHaveBeenCalled();
        expect(reconcile).not.toHaveBeenCalled();
        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({
                module: 'director',
                kind: 'air.chartStale',
                severity: 'warn',
                data: { chartId: 'deadair.lastfm:top-100', expected: 'broadcast-1', current: 'broadcast-2' },
            }),
        );
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('has ended'), expect.anything());
    });

    it('airs a chart pressed in standby that is still standby when the job runs', async () => {
        const { job, putOnAir, record } = build({ broadcastId: undefined });

        await job.run({ chartId: 'deadair.lastfm:top-100' });

        expect(putOnAir).toHaveBeenCalledWith({ chartId: 'deadair.lastfm:top-100' });
        expect(record).not.toHaveBeenCalled();
    });

    it('airs a chart over the broadcast it was pressed on', async () => {
        const { job, putOnAir } = build({ broadcastId: 'broadcast-1' });

        await job.run({ chartId: 'deadair.lastfm:top-100', broadcastId: 'broadcast-1' });

        expect(putOnAir).toHaveBeenCalledWith({ chartId: 'deadair.lastfm:top-100' });
    });

    it('refuses a chart pressed in standby once the station has come on air some other way', async () => {
        const { job, putOnAir, record } = build({ broadcastId: 'broadcast-1' });

        await job.run({ chartId: 'deadair.lastfm:top-100' });

        expect(putOnAir).not.toHaveBeenCalled();
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'air.chartStale' }));
    });
});
