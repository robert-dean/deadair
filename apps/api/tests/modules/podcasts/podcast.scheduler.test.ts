// Fetching ahead of a `syndicated` band: only inside the window, only once per episode (the row is the
// memory), never past the automatic attempts, and never taking the commit pass down with it.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { FETCH_AHEAD_MS, MAX_AUTOMATIC_FETCH_ATTEMPTS, PodcastScheduler } from '../../../src/modules/podcasts/podcast.scheduler.js';
import type { PodcastEpisodeRecord } from '../../../src/modules/podcasts/podcast.episode.js';
import type { PodcastEpisodeRepository } from '../../../src/modules/podcasts/podcast.episode.repository.js';
import type { SyndicatedSource } from '../../../src/modules/podcasts/syndicated.source.js';
import type { ClockBand } from '../../../src/modules/director/clock.bands.js';
import type { ClockBandRepository } from '../../../src/modules/director/clock.band.repository.js';
import { settingsConfig } from '../../utils/settings.config.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/** Half past eight in the morning, UTC. */
const NOW = Date.UTC(2026, 8, 15, 8, 30);

const band = (hour: number, minute: number, kind = 'syndicated'): ClockBand => ({ at: 'clock', hour, minute, kind });

const episode = (overrides: Partial<PodcastEpisodeRecord> = {}): PodcastEpisodeRecord => ({
    id: 'row-1',
    showId: 'deadair.podcast:73b7fb89',
    episodeId: 'ep12',
    showTitle: 'The Long Wave',
    title: 'Episode 12',
    audioUrl: 'https://cdn.example.com/12.mp3',
    seenAt: 0,
    fetchAttempts: 0,
    ...overrides,
});

function build(bands: ClockBand[], found: PodcastEpisodeRecord | undefined, claims = true) {
    const send = vi.fn(async () => 'job-1');
    const claimFetch = vi.fn(async () => claims);
    const scheduler = new PodcastScheduler(
        { active: vi.fn(async () => bands) } as unknown as ClockBandRepository,
        { episodeFor: vi.fn(async () => (found === undefined ? { declined: 'nothing' } : { episode: found })) } as unknown as SyndicatedSource,
        { claimFetch } as unknown as PodcastEpisodeRepository,
        { send } as never,
        settingsConfig({ 'station.timezone': 'UTC' }).config,
        logger,
    );
    return { scheduler, send, claimFetch };
}

describe('PodcastScheduler.ripen', () => {
    it('asks for the audio of the episode a band inside the window will carry, stamped with its slot', async () => {
        const { scheduler, send, claimFetch } = build([band(10, 0)], episode());

        expect(await scheduler.ripen(NOW)).toBe(1);
        expect(claimFetch).toHaveBeenCalledWith('row-1', NOW, expect.any(Number), Date.UTC(2026, 8, 15, 10, 0));
        expect(send).toHaveBeenCalledWith('podcasts.fetch', { episodeId: 'row-1' });
    });

    it('leaves a band further off than the window alone', async () => {
        const later = NOW + FETCH_AHEAD_MS + 60_000;
        const { scheduler, send } = build([band(new Date(later).getUTCHours(), new Date(later).getUTCMinutes())], episode());

        expect(await scheduler.ripen(NOW)).toBe(0);
        expect(send).not.toHaveBeenCalled();
    });

    // The row is the memory: a pass every few seconds, or a restart, cannot ask twice.
    it('asks nothing when the claim does not stick, because a fetch is already out', async () => {
        const { scheduler, send } = build([band(10, 0)], episode(), false);

        expect(await scheduler.ripen(NOW)).toBe(0);
        expect(send).not.toHaveBeenCalled();
    });

    it('asks nothing for an episode already held, or one that has failed too often', async () => {
        const held = build([band(10, 0)], episode({ segmentId: 'seg-12' }));
        expect(await held.scheduler.ripen(NOW)).toBe(0);

        const tired = build([band(10, 0)], episode({ fetchAttempts: MAX_AUTOMATIC_FETCH_ATTEMPTS }));
        expect(await tired.scheduler.ripen(NOW)).toBe(0);
        expect(tired.claimFetch).not.toHaveBeenCalled();
    });

    it('ignores every band that is not a programme', async () => {
        const { scheduler, send } = build([band(10, 0, 'news'), band(9, 0, 'podcast')], episode());

        expect(await scheduler.ripen(NOW)).toBe(0);
        expect(send).not.toHaveBeenCalled();
    });

    it('swallows a failure rather than taking the commit pass with it', async () => {
        const scheduler = new PodcastScheduler(
            { active: vi.fn(async () => Promise.reject(new Error('database is gone'))) } as unknown as ClockBandRepository,
            {} as SyndicatedSource,
            {} as PodcastEpisodeRepository,
            { send: vi.fn() } as never,
            settingsConfig({}).config,
            logger,
        );

        expect(await scheduler.ripen(NOW)).toBe(0);
    });
});
