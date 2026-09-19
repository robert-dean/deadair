// The job's own contribution is one thing: putting a refused sweep somewhere an
// operator will see it. A refusal is not an error and the walk that produced it
// succeeded, so nothing else in the run raises its voice — and unlike the
// failures around it, this one does not resolve itself. It means every id the
// provider hands out has changed, and the station will go on declining every
// hour until somebody looks.
//
// The walk itself is covered in `catalog.sync.service.test.ts`; the service is
// faked here at the one method this calls.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { CatalogSyncJob, type CatalogSyncPayload } from '../../../../src/modules/catalog/ingest/catalog.sync.job.js';
import type { CatalogSyncService, PluginSyncSummary } from '../../../../src/modules/catalog/ingest/catalog.sync.service.js';
import type { ActivityRecorder } from '../../../../src/modules/activity/activity.recorder.js';
import { SWEEP_MAX_PERCENT_KEY } from '../../../../src/modules/catalog/ingest/catalog.sweep.guard.js';
import { CATALOG_SYNC_KEYS } from '../../../../src/modules/catalog/ingest/catalog.sync.schedule.js';

const SPOTIFY_ID = 'deadair.spotify';

const stubLogger = (): Logger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
});

const summary = (overrides: Partial<PluginSyncSummary> = {}): PluginSyncSummary => ({
    pluginId: SPOTIFY_ID,
    playlists: 1,
    items: 2,
    created: 0,
    bound: 2,
    skipped: 0,
    ...overrides,
});

/** Settings as `AppConfig` holds them: strings. */
function config(values: Record<string, string> = {}): AppConfig {
    return { get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback) } as unknown as AppConfig;
}

/** `execute` is protected, and driving `run` would need a scope only to install an actor. */
function build(summaries: PluginSyncSummary[], settings: Record<string, string> = {}) {
    const recorded: Parameters<ActivityRecorder['record']>[0][] = [];
    const activity = {
        record: vi.fn(async (event: Parameters<ActivityRecorder['record']>[0]) => {
            recorded.push(event);
        }),
    } as unknown as ActivityRecorder;
    const sync = { syncAll: vi.fn(async () => summaries), syncPlaylist: vi.fn(async () => summaries) } as unknown as CatalogSyncService;
    const context = { id: 'job-1', name: 'catalog.sync' } as never;
    const job = new CatalogSyncJob(sync, activity, config(settings), context, {} as never, stubLogger());
    const execute = (job as unknown as { execute: (payload?: CatalogSyncPayload | null) => Promise<void> }).execute.bind(job);

    return { recorded, sync, run: (payload?: CatalogSyncPayload | null) => execute(payload) };
}

describe('CatalogSyncJob', () => {
    it('puts a refused sweep on the activity feed, with the numbers behind it', async () => {
        const { recorded, run } = build([summary({ sweep: { kind: 'refused', reason: 'too-many', known: 800, unseen: 800 } })]);

        await run();

        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({
            module: 'catalog',
            kind: 'sweep.refused',
            severity: 'warn',
            data: { pluginId: SPOTIFY_ID, known: 800, unseen: 800 },
        });
        // The sentence has to be actionable on its own: the operator reading it
        // is not going to go looking for the setting that lets them through.
        expect(recorded[0]!.detail).toContain(SWEEP_MAX_PERCENT_KEY);
    });

    it('says nothing about a sweep that ran', async () => {
        const { recorded, run } = build([summary({ sweep: { kind: 'swept', swept: 3 } })]);

        await run();

        expect(recorded).toEqual([]);
    });

    it('says nothing about a walk that never got as far as sweeping', async () => {
        const { recorded, run } = build([summary({ error: 'truncated' })]);

        await run();

        expect(recorded).toEqual([]);
    });

    it('leaves the empty-walk refusal to the log', async () => {
        // A provider that answered with nothing is an outage: already at `warn`,
        // and gone by the next hour. Only the refusal that persists is worth a
        // row somebody has to dismiss.
        const { recorded, run } = build([summary({ sweep: { kind: 'refused', reason: 'nothing-seen' } })]);

        await run();

        expect(recorded).toEqual([]);
    });

    it('reports each refusing plugin separately', async () => {
        const { recorded, run } = build([
            summary({ sweep: { kind: 'refused', reason: 'too-many', known: 800, unseen: 800 } }),
            summary({ pluginId: 'deadair.navidrome', sweep: { kind: 'swept', swept: 1 } }),
            summary({ pluginId: 'deadair.other', sweep: { kind: 'refused', reason: 'too-many', known: 40, unseen: 39 } }),
        ]);

        await run();

        expect(recorded.map(event => event.data?.pluginId)).toEqual([SPOTIFY_ID, 'deadair.other']);
    });

    describe('the schedule', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        /** Hour 7 from the epoch: not a multiple of 6. */
        const offHour = () => vi.setSystemTime(new Date(7 * 3_600_000 + 4_000));

        it("skips the cron run, which pg-boss delivers as null, when switched off with the string 'false'", async () => {
            const { sync, run } = build([summary()], { [CATALOG_SYNC_KEYS.auto]: 'false' });

            await run(null);

            expect(sync.syncAll).not.toHaveBeenCalled();
        });

        it('treats an empty payload as the cron run too', async () => {
            const { sync, run } = build([summary()], { [CATALOG_SYNC_KEYS.auto]: 'false' });

            await run({});

            expect(sync.syncAll).not.toHaveBeenCalled();
        });

        it('skips the cron run in an hour the interval does not land on', async () => {
            vi.useFakeTimers();
            offHour();
            const { sync, run } = build([summary()], { [CATALOG_SYNC_KEYS.everyHours]: '6' });

            await run(undefined);

            expect(sync.syncAll).not.toHaveBeenCalled();
        });

        it('always runs a walk somebody sent, whatever the schedule says', async () => {
            vi.useFakeTimers();
            offHour();
            const settings = { [CATALOG_SYNC_KEYS.auto]: 'false', [CATALOG_SYNC_KEYS.everyHours]: '6' };
            const narrowed = build([summary()], settings);
            const everything = build([summary()], settings);

            await narrowed.run({ pluginId: SPOTIFY_ID });
            await everything.run({ requestedBy: 'operator' });

            expect(narrowed.sync.syncAll).toHaveBeenCalledWith(SPOTIFY_ID, undefined);
            expect(everything.sync.syncAll).toHaveBeenCalledWith(undefined, undefined);
        });
    });

    it('walks one playlist when it was sent one, and the whole plugin otherwise', async () => {
        const one = build([summary()]);
        const plugin = build([summary()]);
        const orphan = build([summary()]);

        await one.run({ pluginId: SPOTIFY_ID, playlistId: 'p1' });
        await plugin.run({ pluginId: SPOTIFY_ID });
        // A playlist id means nothing without the plugin it belongs to.
        await orphan.run({ playlistId: 'p1' });

        expect(one.sync.syncPlaylist).toHaveBeenCalledWith(SPOTIFY_ID, 'p1', undefined);
        expect(one.sync.syncAll).not.toHaveBeenCalled();
        expect(plugin.sync.syncAll).toHaveBeenCalledWith(SPOTIFY_ID, undefined);
        expect(orphan.sync.syncAll).toHaveBeenCalledWith(undefined, undefined);
    });

    describe('a refresh an operator asked for', () => {
        it('puts one entry on the feed with the counts', async () => {
            const { recorded, run } = build([summary({ created: 3, bound: 10 }), summary({ pluginId: 'deadair.navidrome', created: 1, bound: 4 })]);

            await run({ requestedBy: 'operator' });

            expect(recorded).toHaveLength(1);
            expect(recorded[0]).toMatchObject({
                module: 'catalog',
                kind: 'sync.finished',
                severity: 'info',
                data: { created: 4, bound: 14, failed: [] },
            });
        });

        it('says which source could not be read', async () => {
            const { recorded, run } = build([summary({ pluginId: SPOTIFY_ID, error: 'hidden' })]);

            await run({ pluginId: SPOTIFY_ID, playlistId: 'p1', requestedBy: 'operator' });

            expect(recorded[0]).toMatchObject({ severity: 'warn', data: { failed: [SPOTIFY_ID], playlistId: 'p1' } });
            expect(recorded[0]!.detail).toContain(`${SPOTIFY_ID} (hidden)`);
        });

        it('leaves a walk nobody asked for off the feed', async () => {
            const { recorded, run } = build([summary({ created: 3 })]);

            await run({ pluginId: SPOTIFY_ID });
            await run(null);

            expect(recorded).toEqual([]);
        });
    });
});
