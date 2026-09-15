// Fetching an episode's audio: redirects followed by hand with every hop's name checked, the container
// read from the bytes, the body streamed into a real store under a ceiling and a floor, and every
// failure written on the episode rather than thrown.

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import {
    MAX_EPISODE_BYTES,
    MIN_EPISODE_BYTES,
    PodcastFetchOptions,
    PodcastFetchService,
} from '../../../src/modules/podcasts/podcast.fetch.service.js';
import type { PodcastEpisodeRecord } from '../../../src/modules/podcasts/podcast.episode.js';
import type { PodcastEpisodeRepository } from '../../../src/modules/podcasts/podcast.episode.repository.js';
import type { SegmentRepository, SyndicatedSegment } from '../../../src/modules/render/segment.repository.js';
import { SegmentStore } from '../../../src/modules/render/segment.store.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const EPISODE: PodcastEpisodeRecord = {
    id: 'row-1',
    showId: 'deadair.podcast:73b7fb89',
    episodeId: 'ep12',
    showTitle: 'The Long Wave',
    title: 'Episode 12',
    audioUrl: 'https://tracker.example.com/r/cdn.example.com/12.mp3',
    durationMs: 3_723_000,
    publishedAt: Date.parse('2026-09-14T06:00:00.000Z'),
    seenAt: 0,
    fetchAttempts: 0,
};

/** An MP3 of this many bytes: an ID3 tag, then padding. */
const mp3 = (size: number): Uint8Array<ArrayBuffer> => {
    const bytes = new Uint8Array(size);
    bytes.set([0x49, 0x44, 0x33, 0x04]);
    return bytes;
};

let root: string;
let store: SegmentStore;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deadair-podcast-fetch-test-'));
    store = new SegmentStore(root);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

interface Harness {
    service: PodcastFetchService;
    created: SyndicatedSegment[];
    fetched: [string, string][];
    failed: [string, string][];
    requested: string[];
}

function build(
    answers: Record<string, () => Response>,
    options: { episode?: PodcastEpisodeRecord | undefined; resolve?: Record<string, string[]> } = {},
): Harness {
    const created: SyndicatedSegment[] = [];
    const fetched: [string, string][] = [];
    const failed: [string, string][] = [];
    const requested: string[] = [];

    const episodes = {
        get: vi.fn(async () => ('episode' in options ? options.episode : EPISODE)),
        markFetched: vi.fn(async (id: string, segmentId: string) => void fetched.push([id, segmentId])),
        markFetchFailed: vi.fn(async (id: string, error: string) => void failed.push([id, error])),
    } as unknown as PodcastEpisodeRepository;

    const segments = {
        createSyndicated: vi.fn(async (carried: SyndicatedSegment) => {
            created.push(carried);
            return { id: 'seg-1' };
        }),
    } as unknown as SegmentRepository;

    const fetch = vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        requested.push(url);
        const answer = answers[url];
        if (answer === undefined) throw new Error(`nothing scripted for ${url}`);
        return answer();
    }) as unknown as typeof globalThis.fetch;

    const resolve = async (hostname: string): Promise<string[]> => options.resolve?.[hostname] ?? ['93.184.216.34'];

    const service = new PodcastFetchService(
        episodes,
        segments,
        store,
        new PodcastFetchOptions(fetch, resolve),
        { record: vi.fn(async () => undefined) } as unknown as ActivityRecorder,
        stubLogger(),
    );

    return { service, created, fetched, failed, requested };
}

const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
const audio =
    (bytes: Uint8Array<ArrayBuffer>, type = 'audio/mpeg') =>
    () =>
        new Response(bytes, { status: 200, headers: { 'content-type': type } });

describe('PodcastFetchService.fetchEpisode', () => {
    it('follows the trackers to the audio, keeps it, and makes it a ready segment', async () => {
        const harness = build({
            [EPISODE.audioUrl]: redirect('https://cdn.example.com/12.mp3'),
            'https://cdn.example.com/12.mp3': audio(mp3(MIN_EPISODE_BYTES + 10), 'application/octet-stream'),
        });

        const outcome = await harness.service.fetchEpisode('row-1');

        expect(outcome).toEqual({ outcome: 'fetched', segmentId: 'seg-1', bytes: MIN_EPISODE_BYTES + 10, ext: 'mp3' });
        expect(harness.fetched).toEqual([['row-1', 'seg-1']]);
        expect(harness.created[0]).toMatchObject({
            kind: 'syndicated',
            label: 'The Long Wave: Episode 12',
            audioExt: 'mp3',
            durationMs: 3_723_000,
            context: { podcastEpisodeId: 'row-1', showTitle: 'The Long Wave', episodeTitle: 'Episode 12', publishedAt: '2026-09-14T06:00:00.000Z' },
        });
        expect(await store.exists(harness.created[0]!.audioChecksum, 'mp3')).toBe(true);
    });

    // An enclosure is named by whoever publishes the feed, and a public name can point at this machine.
    it('refuses a hop whose name reaches a private address, before connecting to it', async () => {
        const harness = build(
            { [EPISODE.audioUrl]: redirect('https://sneaky.example.com/12.mp3') },
            { resolve: { 'sneaky.example.com': ['93.184.216.34', '127.0.0.1'] } },
        );

        const outcome = await harness.service.fetchEpisode('row-1');

        expect(outcome).toEqual({ outcome: 'failed', error: expect.stringContaining('private address') });
        expect(harness.requested).toEqual([EPISODE.audioUrl]);
        expect(harness.failed[0]?.[1]).toContain('sneaky.example.com');
    });

    it('refuses what is not audio, whatever the publisher says it is', async () => {
        const page = new TextEncoder().encode(`<!DOCTYPE html>${' '.repeat(MIN_EPISODE_BYTES)}`);
        const harness = build({ [EPISODE.audioUrl]: audio(page, 'audio/mpeg') });

        const outcome = await harness.service.fetchEpisode('row-1');

        expect(outcome).toMatchObject({ outcome: 'failed', error: expect.stringContaining('not audio') });
        expect(await readdir(root)).toEqual([]);
    });

    it('refuses a file too small to be an episode, and keeps nothing of it', async () => {
        const harness = build({ [EPISODE.audioUrl]: audio(mp3(1_024)) });

        const outcome = await harness.service.fetchEpisode('row-1');

        expect(outcome).toMatchObject({ outcome: 'failed', error: expect.stringContaining('not an episode') });
        expect((await readdir(root)).filter(name => !name.startsWith('.'))).toEqual([]);
        expect(harness.created).toEqual([]);
    });

    it('refuses a body past the ceiling as it arrives, rather than trusting what it claims', async () => {
        // A body that says nothing about its length and keeps coming: the refusal is from the count.
        let sent = 0;
        const endless = () =>
            new Response(
                new ReadableStream<Uint8Array>({
                    pull(controller) {
                        const chunk = new Uint8Array(4 * 1024 * 1024);
                        if (sent === 0) chunk.set([0x49, 0x44, 0x33]);
                        sent += chunk.byteLength;
                        controller.enqueue(chunk);
                    },
                }),
                { status: 200 },
            );
        const harness = build({ [EPISODE.audioUrl]: endless });

        const outcome = await harness.service.fetchEpisode('row-1');

        expect(outcome).toMatchObject({ outcome: 'failed', error: expect.stringContaining('larger than') });
        // Stopped at the ceiling, give or take the chunk a stream reads ahead of its consumer: the
        // download was cancelled rather than drained.
        expect(sent).toBeLessThanOrEqual(MAX_EPISODE_BYTES + 3 * 4 * 1024 * 1024);
        expect(harness.created).toEqual([]);
    });

    it('says what the publisher answered when it is not a success', async () => {
        const harness = build({ [EPISODE.audioUrl]: () => new Response('gone', { status: 410 }) });

        expect(await harness.service.fetchEpisode('row-1')).toEqual({ outcome: 'failed', error: 'the publisher answered 410' });
    });

    it('does nothing for an episode already held, or one the station does not know', async () => {
        const held = build({}, { episode: { ...EPISODE, segmentId: 'seg-9' } });
        expect(await held.service.fetchEpisode('row-1')).toEqual({ outcome: 'held', segmentId: 'seg-9' });
        expect(held.requested).toEqual([]);

        const gone = build({}, { episode: undefined });
        expect(await gone.service.fetchEpisode('row-1')).toEqual({ outcome: 'gone' });
    });
});
