// The switch, and the priority. Off means the walk asks nothing at all, and the off case is tested
// with the STRING a settings row holds: a test that passed a real boolean would pass either way.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { LyricsJob } from '../../../src/modules/lyrics/lyrics.job.js';
import { LYRICS_KEYS } from '../../../src/modules/lyrics/lyrics.keys.js';
import type { LyricsPassSummary } from '../../../src/modules/lyrics/lyrics.service.js';
import { settingsConfig } from '../../utils/settings.config.js';

const stubLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const summary: LyricsPassSummary = { scanned: 2, found: 1, instrumental: 0, missed: 1, failed: 0 };

const build = (rows: Record<string, string>, read = async () => ({ trackIds: ['next'], artistIds: [], albumIds: [] })) => {
    const fetchPending = vi.fn(async () => summary);
    const logger = stubLogger();
    const job = new LyricsJob(
        { fetchPending } as never,
        { read } as never,
        settingsConfig(rows).config,
        { id: 'job-1' } as never,
        { override: vi.fn() } as never,
        logger,
    );
    return { job, fetchPending, logger };
};

describe('LyricsJob', () => {
    it('asks nothing when the switch has never been set, which is off', async () => {
        const { job, fetchPending } = build({});
        await job.run();
        expect(fetchPending).not.toHaveBeenCalled();
    });

    it('asks nothing when the switch is stored as the string false', async () => {
        const { job, fetchPending } = build({ [LYRICS_KEYS.fetch]: 'false' });
        await job.run();
        expect(fetchPending).not.toHaveBeenCalled();
    });

    it('walks, led by what the station is about to play, when it is on', async () => {
        const { job, fetchPending, logger } = build({ [LYRICS_KEYS.fetch]: 'true' });
        await job.run();
        expect(fetchPending).toHaveBeenCalledWith(75, expect.any(AbortSignal), ['next']);
        expect(logger.info).toHaveBeenCalledWith('lyrics pass', expect.objectContaining({ found: 1, ahead: 1 }));
    });

    it('still walks when the running order cannot be read', async () => {
        const { job, fetchPending } = build({ [LYRICS_KEYS.fetch]: 'on' }, async () => {
            throw new Error('no lineup');
        });
        await job.run();
        expect(fetchPending).toHaveBeenCalledWith(75, expect.any(AbortSignal), []);
    });
});
