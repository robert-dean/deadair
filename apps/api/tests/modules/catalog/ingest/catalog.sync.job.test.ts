// The job's own contribution is one thing: putting a refused sweep somewhere an
// operator will see it. A refusal is not an error and the walk that produced it
// succeeded, so nothing else in the run raises its voice — and unlike the
// failures around it, this one does not resolve itself. It means every id the
// provider hands out has changed, and the station will go on declining every
// hour until somebody looks.
//
// The walk itself is covered in `catalog.sync.service.test.ts`; the service is
// faked here at the one method this calls.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { CatalogSyncJob } from '../../../../src/modules/catalog/ingest/catalog.sync.job.js';
import type { CatalogSyncService, PluginSyncSummary } from '../../../../src/modules/catalog/ingest/catalog.sync.service.js';
import type { ActivityRecorder } from '../../../../src/modules/activity/activity.recorder.js';
import { SWEEP_MAX_PERCENT_KEY } from '../../../../src/modules/catalog/ingest/catalog.sweep.guard.js';

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

/** `execute` is protected, and driving `run` would need a scope only to install an actor. */
function build(summaries: PluginSyncSummary[]) {
    const recorded: Parameters<ActivityRecorder['record']>[0][] = [];
    const activity = {
        record: vi.fn(async (event: Parameters<ActivityRecorder['record']>[0]) => {
            recorded.push(event);
        }),
    } as unknown as ActivityRecorder;
    const sync = { syncAll: vi.fn(async () => summaries) } as unknown as CatalogSyncService;
    const context = { id: 'job-1', name: 'catalog.sync' } as never;
    const job = new CatalogSyncJob(sync, activity, context, {} as never, stubLogger());

    return { recorded, run: () => (job as unknown as { execute: () => Promise<void> }).execute() };
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
});
