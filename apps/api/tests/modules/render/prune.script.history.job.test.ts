// The one thing in the render module that deletes anything. Everything here is about the direction
// its failures fall: a sweep that does not run costs disk, and a sweep that runs when the operator
// meant to keep everything costs the only record of what the station said.

import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { PruneScriptHistoryJob } from '../../../src/modules/render/prune.script.history.job.js';
import { SCRIPT_HISTORY_KEYS } from '../../../src/modules/render/script.history.settings.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

function harness(values: Record<string, unknown> = {}, removed = 0) {
    const history = { pruneOlderThanDays: vi.fn(async () => removed) };
    const config = { get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) } as unknown as AppConfig;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const job = new PruneScriptHistoryJob(history as never, config, { id: 'job-1' } as never, {} as never, logger as never);

    return { job, history, logger };
}

describe('PruneScriptHistoryJob', () => {
    it('sweeps to the window the operator set', async () => {
        const { job, history } = harness({ [SCRIPT_HISTORY_KEYS.retentionDays]: 30 }, 12);

        await job.run();

        expect(history.pruneOlderThanDays).toHaveBeenCalledWith(30);
    });

    it('deletes nothing at all when the window is zero', async () => {
        // Zero means keep everything. Reaching the repository with it would be the one bug in this
        // file that cannot be undone.
        const { job, history } = harness({ [SCRIPT_HISTORY_KEYS.retentionDays]: 0 });

        await job.run();

        expect(history.pruneOlderThanDays).not.toHaveBeenCalled();
    });

    it('deletes nothing when the setting is unreadable', async () => {
        const { job, history } = harness({ [SCRIPT_HISTORY_KEYS.retentionDays]: 'whenever' });

        await job.run();

        expect(history.pruneOlderThanDays).not.toHaveBeenCalled();
    });

    it('reads the window on every run, so lowering it takes tonight', async () => {
        // Not captured at construction: the setting is live and this job outlives any one value of
        // it, so an operator who lowers the window means tonight rather than after a restart.
        const values: Record<string, unknown> = { [SCRIPT_HISTORY_KEYS.retentionDays]: 90 };
        const { job, history } = harness(values);

        await job.run();
        values[SCRIPT_HISTORY_KEYS.retentionDays] = 7;
        await job.run();

        expect(history.pruneOlderThanDays).toHaveBeenNthCalledWith(1, 90);
        expect(history.pruneOlderThanDays).toHaveBeenNthCalledWith(2, 7);
    });

    it('says nothing on a night with nothing old enough', async () => {
        // Which is every night on a young station. A nightly line reporting no work is how a log
        // stops being read.
        const { job, logger } = harness({ [SCRIPT_HISTORY_KEYS.retentionDays]: 90 }, 0);

        await job.run();

        expect(logger.info).not.toHaveBeenCalled();
    });

    it('says how much went when something did', async () => {
        const { job, logger } = harness({ [SCRIPT_HISTORY_KEYS.retentionDays]: 90 }, 4);

        await job.run();

        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('swept'), expect.objectContaining({ removed: 4, days: 90 }));
    });
});
