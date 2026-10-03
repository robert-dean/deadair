// The lyrics walk: each provider a record is waiting on is asked in the operator's order, and its
// answer is written as words, an instrumental, a miss or a failure. No database and no HTTP: the
// repository is a recording of what was asked of it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { PluginError, type PluginManifest } from '@deadair/plugin-sdk';

import {
    LYRICS_CALL_TIMEOUT_MS,
    LYRICS_FAILURE_MAX_RETRY_MS,
    LYRICS_FAILURE_RETRY_MS,
    LYRICS_MISS_TTL_MS,
    LyricsService,
} from '../../../src/modules/lyrics/lyrics.service.js';
import { LYRICS_KEYS } from '../../../src/modules/lyrics/lyrics.keys.js';
import type { PendingLyricsTrack } from '../../../src/modules/lyrics/lyrics.repository.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { settingsConfig } from '../../utils/settings.config.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const LRCLIB = 'deadair.lrclib';
const OTHER = 'deadair.other';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

function manifest(id: string, capabilities: string[] = ['lyrics']): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        capabilities,
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) } as unknown as PluginManifest['configSchema'],
    };
}

function record(id: string, lyricsFor: unknown, priority = 100, overrides: Partial<PluginRecord> = {}): PluginRecord {
    return {
        id,
        dir: `/plugins/${id}`,
        origin: 'bundled',
        status: 'active',
        manifest: manifest(id),
        instance: { priority, init: vi.fn(), lyricsFor } as never,
        ...overrides,
    };
}

function fakeRepository(tracks: PendingLyricsTrack[] = []) {
    return {
        listTracksNeedingLyrics: vi.fn(async () => tracks),
        saveWords: vi.fn(async () => {}),
        saveInstrumental: vi.fn(async () => {}),
        recordMiss: vi.fn(async () => {}),
        recordFailure: vi.fn(async () => {}),
    };
}

const track = (outstanding: string[] = [LRCLIB]): PendingLyricsTrack => ({
    id: 'track-1',
    title: 'Glory Box',
    artistId: 'artist-1',
    artistName: 'Portishead',
    albumId: 'album-1',
    albumName: 'Dummy',
    durationMs: 301_000,
    outstanding,
});

let repository: ReturnType<typeof fakeRepository>;

const build = (records: PluginRecord[], tracks: PendingLyricsTrack[] = [track()], rows: Record<string, string> = {}): LyricsService => {
    const registry = new PluginRegistry();
    registry.setAll(records);
    repository = fakeRepository(tracks);
    const invoker = new PluginInvoker(registry, stubPluginLog().log);
    return new LyricsService(registry, invoker, repository as never, settingsConfig(rows).config, stubLogger());
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('providers', () => {
    it('lists the active lyrics plugins, lowest declared priority first', () => {
        const service = build([record(OTHER, vi.fn(), 500), record(LRCLIB, vi.fn(), 100)]);
        expect(service.providers().map(plugin => plugin.record.id)).toEqual([LRCLIB, OTHER]);
    });

    it('puts the operator’s order ahead of the declared one', () => {
        const service = build([record(OTHER, vi.fn(), 500), record(LRCLIB, vi.fn(), 100)], [], {
            [LYRICS_KEYS.providerOrder]: JSON.stringify([{ source: OTHER }]),
        });
        expect(service.providers().map(plugin => plugin.record.id)).toEqual([OTHER, LRCLIB]);
    });

    it('ignores a plugin that declares lyrics and does not implement it', () => {
        const service = build([record(LRCLIB, undefined)]);
        expect(service.providers()).toEqual([]);
    });

    it('ignores a plugin that is not running', () => {
        const service = build([record(LRCLIB, vi.fn(), 100, { status: 'failed', error: 'boom' })]);
        expect(service.providers()).toEqual([]);
    });
});

describe('fetchPending', () => {
    it('asks nothing of the database when no plugin can answer', async () => {
        const service = build([]);
        expect(await service.fetchPending(10)).toEqual({ scanned: 0, found: 0, instrumental: 0, missed: 0, failed: 0 });
        expect(repository.listTracksNeedingLyrics).not.toHaveBeenCalled();
    });

    it('asks with the record’s duration, which is what a strict source matches on', async () => {
        const lyricsFor = vi.fn(async () => ({}));
        const service = build([record(LRCLIB, lyricsFor)]);

        await service.fetchPending(10);

        expect(lyricsFor).toHaveBeenCalledWith(
            expect.objectContaining({ artist: 'Portishead', title: 'Glory Box', album: 'Dummy', durationMs: 301_000 }),
        );
    });

    it('stores words, without expiry', async () => {
        const service = build([
            record(
                LRCLIB,
                vi.fn(async () => ({ plain: 'words', synced: [{ atMs: 1000, text: 'words' }] })),
            ),
        ]);

        const summary = await service.fetchPending(10);

        expect(summary).toEqual({ scanned: 1, found: 1, instrumental: 0, missed: 0, failed: 0 });
        expect(repository.saveWords).toHaveBeenCalledWith('track-1', LRCLIB, { plain: 'words', synced: [{ atMs: 1000, text: 'words' }] });
    });

    it('stores an instrumental as an answer', async () => {
        const service = build([
            record(
                LRCLIB,
                vi.fn(async () => ({ instrumental: true, providerRef: '9' })),
            ),
        ]);

        const summary = await service.fetchPending(10);

        expect(summary.instrumental).toBe(1);
        expect(repository.saveInstrumental).toHaveBeenCalledWith('track-1', LRCLIB, '9');
    });

    it('records a miss with its own clock', async () => {
        const service = build([
            record(
                LRCLIB,
                vi.fn(async () => ({})),
            ),
        ]);

        const summary = await service.fetchPending(10);

        expect(summary.missed).toBe(1);
        expect(repository.recordMiss).toHaveBeenCalledWith('track-1', LRCLIB, LYRICS_MISS_TTL_MS);
    });

    it('records a failure with a backoff, and carries on', async () => {
        const failing = vi.fn(async () => {
            throw new PluginError('refused this client');
        });
        const service = build(
            [
                record(LRCLIB, failing),
                record(
                    OTHER,
                    vi.fn(async () => ({ plain: 'words' })),
                    500,
                ),
            ],
            [track([LRCLIB, OTHER])],
        );

        const summary = await service.fetchPending(10);

        expect(summary).toEqual({ scanned: 1, found: 1, instrumental: 0, missed: 0, failed: 1 });
        expect(repository.recordFailure).toHaveBeenCalledWith(
            'track-1',
            LRCLIB,
            expect.stringContaining('refused'),
            LYRICS_FAILURE_RETRY_MS,
            LYRICS_FAILURE_MAX_RETRY_MS,
        );
        expect(repository.saveWords).toHaveBeenCalledWith('track-1', OTHER, { plain: 'words' });
    });

    it('asks only the providers the record is still waiting on', async () => {
        const first = vi.fn(async () => ({ plain: 'words' }));
        const second = vi.fn(async () => ({ plain: 'words' }));
        const service = build([record(LRCLIB, first), record(OTHER, second, 500)], [track([OTHER])]);

        await service.fetchPending(10);

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledOnce();
    });

    it('stops between records once told to', async () => {
        const controller = new AbortController();
        const lyricsFor = vi.fn(async () => {
            controller.abort();
            return { plain: 'words' };
        });
        const service = build([record(LRCLIB, lyricsFor)], [track(), { ...track(), id: 'track-2' }]);

        const summary = await service.fetchPending(10, controller.signal);

        expect(lyricsFor).toHaveBeenCalledOnce();
        expect(summary.scanned).toBe(1);
    });

    it('bounds each call', async () => {
        const service = build([
            record(
                LRCLIB,
                vi.fn(async () => ({})),
            ),
        ]);
        const invoke = vi.spyOn(PluginInvoker.prototype, 'invoke');

        await service.fetchPending(10);

        expect(invoke).toHaveBeenCalledWith(LRCLIB, 'lyrics.lyricsFor', expect.any(Function), { timeoutMs: LYRICS_CALL_TIMEOUT_MS });
        invoke.mockRestore();
    });
});
