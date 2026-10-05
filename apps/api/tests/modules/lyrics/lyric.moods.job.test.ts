// The mood walk's switch. Off means it asks nothing, and the off case is the STRING a settings row holds.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { LyricMoodsJob } from '../../../src/modules/lyrics/lyric.moods.job.js';
import { LYRIC_MOODS_KEYS } from '../../../src/modules/lyrics/lyrics.keys.js';
import { settingsConfig } from '../../utils/settings.config.js';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const build = (rows: Record<string, string>) => {
    const labelPending = vi.fn(async () => ({ judged: 1, unplaced: 0, failed: 0, yielded: false }));
    const job = new LyricMoodsJob(
        { labelPending } as never,
        { read: async () => ({ trackIds: ['next'], artistIds: [], albumIds: [] }) } as never,
        settingsConfig(rows).config,
        { id: 'job-1' } as never,
        { override: vi.fn() } as never,
        logger(),
    );
    return { job, labelPending };
};

describe('LyricMoodsJob', () => {
    it('asks nothing with the switch unset or stored as the string false', async () => {
        for (const rows of [{}, { [LYRIC_MOODS_KEYS.enabled]: 'false' }] as Record<string, string>[]) {
            const { job, labelPending } = build(rows);
            await job.run();
            expect(labelPending).not.toHaveBeenCalled();
        }
    });

    it('walks, led by what the station is about to play, when it is on', async () => {
        const { job, labelPending } = build({ [LYRIC_MOODS_KEYS.enabled]: 'true' });
        await job.run();
        expect(labelPending).toHaveBeenCalledWith(20, expect.any(AbortSignal), ['next']);
    });
});
