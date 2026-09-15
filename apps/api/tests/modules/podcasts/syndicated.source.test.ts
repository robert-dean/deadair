// What a `syndicated` band carries: the newest episode of the show its topic names, if the station
// holds it and has not placed it already, and a sentence saying why not otherwise.

import { describe, expect, it, vi } from 'vitest';

import { SyndicatedSource } from '../../../src/modules/podcasts/syndicated.source.js';
import type { PodcastEpisodeRecord } from '../../../src/modules/podcasts/podcast.episode.js';
import type { PodcastEpisodeRepository } from '../../../src/modules/podcasts/podcast.episode.repository.js';
import type { Topic } from '../../../src/modules/topics/topic.js';
import type { TopicRepository } from '../../../src/modules/topics/topic.repository.js';

const SHOW = 'deadair.podcast:73b7fb89';
const SUBJECT = { id: 'topic-1', key: 'long-wave', label: 'The Long Wave' };

const topic = (config: Record<string, unknown>): Topic => ({
    id: 'topic-1',
    kind: 'syndicated',
    key: 'long-wave',
    label: 'The Long Wave',
    config,
    position: 0,
});

const episode = (overrides: Partial<PodcastEpisodeRecord> = {}): PodcastEpisodeRecord => ({
    id: 'row-1',
    showId: SHOW,
    episodeId: 'ep12',
    showTitle: 'The Long Wave',
    title: 'Episode 12',
    audioUrl: 'https://cdn.example.com/12.mp3',
    seenAt: 0,
    fetchAttempts: 0,
    segmentId: 'seg-12',
    durationMs: 3_723_000,
    ...overrides,
});

function build(topics: Topic[], newest: PodcastEpisodeRecord | undefined) {
    const newestFor = vi.fn(async () => newest);
    const source = new SyndicatedSource(
        { list: vi.fn(async () => topics) } as unknown as TopicRepository,
        { newest: newestFor } as unknown as PodcastEpisodeRepository,
    );
    return { source, newestFor };
}

describe('SyndicatedSource.segmentFor', () => {
    it('carries the newest episode of the show the topic names, with its length', async () => {
        const { source, newestFor } = build([topic({ show: SHOW })], episode());

        expect(await source.segmentFor(SUBJECT, new Set())).toEqual({ segmentId: 'seg-12', durationMs: 3_723_000 });
        expect(newestFor).toHaveBeenCalledWith(SHOW);
    });

    it('carries the newest of any show for a band about nothing in particular', async () => {
        const { source, newestFor } = build([], episode());

        expect(await source.segmentFor(undefined, new Set())).toMatchObject({ segmentId: 'seg-12' });
        expect(newestFor).toHaveBeenCalledWith(undefined);
    });

    // A band an operator pointed at a show meant that show. Carrying every show instead would put a
    // programme on under the wrong name, which is the one failure this refuses outright.
    it('declines a topic that names no show, rather than carrying any show', async () => {
        const { source, newestFor } = build([topic({})], episode());

        expect(await source.segmentFor(SUBJECT, new Set())).toEqual({ declined: expect.stringContaining('names no subscription') });
        expect(newestFor).not.toHaveBeenCalled();
    });

    it('declines when the show has nothing new', async () => {
        const { source } = build([topic({ show: SHOW })], undefined);

        expect(await source.segmentFor(SUBJECT, new Set())).toEqual({ declined: expect.stringContaining('no new episode') });
    });

    it('declines an episode not fetched yet, and says why when the fetch failed', async () => {
        const waiting = build([topic({ show: SHOW })], episode({ segmentId: undefined }));
        expect(await waiting.source.segmentFor(SUBJECT, new Set())).toEqual({ declined: expect.stringContaining('not fetched yet') });

        const failed = build([topic({ show: SHOW })], episode({ segmentId: undefined, fetchError: 'the publisher answered 404' }));
        expect(await failed.source.segmentFor(SUBJECT, new Set())).toEqual({ declined: expect.stringContaining('the publisher answered 404') });
    });

    it('declines an episode the running order already holds', async () => {
        const { source } = build([topic({ show: SHOW })], episode());

        expect(await source.segmentFor(SUBJECT, new Set(['seg-12']))).toEqual({ declined: expect.stringContaining('already in the running order') });
    });
});
