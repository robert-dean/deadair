// The one thing in the activity module that deletes anything, and the direction its failures have
// to fall is the same as the render module's sweep: a run that does not happen costs disk, and a run
// that happens when the operator meant to keep everything costs the only record of a night nobody
// can reconstruct.

import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { PruneActivityJob } from '../../../src/modules/activity/prune.activity.job.js';
import { ACTIVITY_DEFAULTS, ACTIVITY_KEYS, resolveActivityRetentionDays } from '../../../src/modules/activity/activity.settings.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const config = (values: Record<string, unknown>): AppConfig =>
    ({ get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) }) as unknown as AppConfig;

function harness(values: Record<string, unknown> = {}, removed = 0) {
    const events = { pruneOlderThanDays: vi.fn(async () => removed) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const job = new PruneActivityJob(events as never, config(values), { id: 'job-1' } as never, {} as never, logger as never);

    return { job, events, logger };
}

describe('resolveActivityRetentionDays', () => {
    it('keeps the registry default when nobody has set it', () => {
        expect(resolveActivityRetentionDays(config({}))).toBe(ACTIVITY_DEFAULTS.retentionDays);
    });

    it('reads a number that arrived as a string, which is how a settings row stores one', () => {
        expect(resolveActivityRetentionDays(config({ [ACTIVITY_KEYS.retentionDays]: '14' }))).toBe(14);
    });

    it('floors a fractional window rather than handing a fraction to an interval', () => {
        expect(resolveActivityRetentionDays(config({ [ACTIVITY_KEYS.retentionDays]: 7.9 }))).toBe(7);
    });

    it.each([
        ['zero, which is what the setting says means keep everything', 0],
        ['a negative window, which cannot mean anything else', -5],
        ['a row somebody typed a word into', 'soon'],
        ['an empty row', ''],
    ])('keeps everything for %s', (_, value) => {
        expect(resolveActivityRetentionDays(config({ [ACTIVITY_KEYS.retentionDays]: value }))).toBe(0);
    });
});

describe('PruneActivityJob', () => {
    it('sweeps to the window the operator set', async () => {
        const { job, events } = harness({ [ACTIVITY_KEYS.retentionDays]: 30 }, 12);

        await job.run();

        expect(events.pruneOlderThanDays).toHaveBeenCalledWith(30);
    });

    it('deletes nothing at all when the window is zero', async () => {
        // Reaching the repository with a zero is the one bug in this file that cannot be undone.
        const { job, events } = harness({ [ACTIVITY_KEYS.retentionDays]: 0 });

        await job.run();

        expect(events.pruneOlderThanDays).not.toHaveBeenCalled();
    });

    it('deletes nothing when the setting is unreadable', async () => {
        const { job, events } = harness({ [ACTIVITY_KEYS.retentionDays]: 'whenever' });

        await job.run();

        expect(events.pruneOlderThanDays).not.toHaveBeenCalled();
    });

    it('says nothing on a night that swept nothing', async () => {
        // Every night on a young station. A nightly line reporting that nothing happened is how a
        // log stops being read, which is the same argument the feed itself is built on.
        const { job, logger } = harness({ [ACTIVITY_KEYS.retentionDays]: 30 }, 0);

        await job.run();

        expect(logger.info).not.toHaveBeenCalled();
    });
});
