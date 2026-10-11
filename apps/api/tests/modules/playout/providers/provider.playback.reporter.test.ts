// Telling a provider its copy aired: one `started` on the edge a record goes to air, one `ended` on
// the next edge whatever that item is, and nothing at all for a provider that never asked.

import type { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import type { Logger } from '@maroonedsoftware/logger';
import type { PluginManifest } from '@deadair/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';

import { ProviderPlaybackReporter } from '../../../../src/modules/playout/providers/provider.playback.reporter.js';
import type { Rundown, RundownItem } from '../../../../src/modules/playout/rundown.js';
import { PluginRegistry } from '../../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../../src/modules/plugins/types/plugin.record.js';
import { RENDER_PLUGIN_ID } from '../../../../src/modules/render/segment.source.js';

const REPORTING = 'deadair.reporting';
const SILENT = 'deadair.silent';

function record(id: string, instance: Record<string, unknown>): PluginRecord {
    const manifest = {
        id,
        name: id,
        version: '1.0.0',
        capabilities: ['stream'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) },
    } as unknown as PluginManifest;

    return { id, dir: `/plugins/${id}`, origin: 'bundled', status: 'active', manifest, instance: { init: vi.fn(), ...instance } as never };
}

const item = (pluginId: string, externalId: string): RundownItem => ({ pluginId, externalId }) as unknown as RundownItem;

const build = () => {
    const registry = new PluginRegistry();
    registry.setAll([
        record(REPORTING, { resolveStreamUrl: vi.fn(), reportPlayback: vi.fn() }),
        record(SILENT, { resolveStreamUrl: vi.fn() }),
    ]);
    const send = vi.fn(async () => 'job-id');
    const jobs = { send } as unknown as PgBossJobBroker;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;
    const rundown = { onAired: vi.fn(() => () => {}) } as unknown as Rundown;

    return { reporter: new ProviderPlaybackReporter(rundown, registry, jobs, logger), send };
};

describe('ProviderPlaybackReporter', () => {
    it('reports a record starting when it goes to air', () => {
        const { reporter, send } = build();

        reporter.aired(item(REPORTING, 'TR:1'), 1_000);

        expect(send).toHaveBeenCalledExactlyOnceWith('playout.report_playback', {
            pluginId: REPORTING,
            trackId: 'TR:1',
            report: { event: 'started', startedAt: 1_000 },
        });
    });

    // The next item is whatever it is: a break, another provider's record, or one of this provider's.
    it.each([
        ['a break', item(RENDER_PLUGIN_ID, 'segment-1')],
        ['another provider', item(SILENT, 'track-9')],
    ])('reports it ending, with what was heard, when %s takes over', (_, next) => {
        const { reporter, send } = build();
        reporter.aired(item(REPORTING, 'TR:1'), 1_000);
        send.mockClear();

        reporter.aired(next, 181_000);

        expect(send).toHaveBeenCalledExactlyOnceWith('playout.report_playback', {
            pluginId: REPORTING,
            trackId: 'TR:1',
            report: { event: 'ended', startedAt: 1_000, elapsedMs: 180_000 },
        });
    });

    it('ends one record and starts the next when the same provider plays twice in a row', () => {
        const { reporter, send } = build();
        reporter.aired(item(REPORTING, 'TR:1'), 1_000);
        send.mockClear();

        reporter.aired(item(REPORTING, 'TR:2'), 5_000);

        expect(send.mock.calls.map(call => (call as unknown[])[1])).toEqual([
            { pluginId: REPORTING, trackId: 'TR:1', report: { event: 'ended', startedAt: 1_000, elapsedMs: 4_000 } },
            { pluginId: REPORTING, trackId: 'TR:2', report: { event: 'started', startedAt: 5_000 } },
        ]);
    });

    it('sends nothing for a provider that never asked to hear', () => {
        const { reporter, send } = build();

        reporter.aired(item(SILENT, 'track-9'), 1_000);
        reporter.aired(item(RENDER_PLUGIN_ID, 'segment-1'), 2_000);

        expect(send).not.toHaveBeenCalled();
    });

    it('forgets the record on air when stopped, so a restart never reports a stale end', () => {
        const { reporter, send } = build();
        reporter.aired(item(REPORTING, 'TR:1'), 1_000);
        reporter.stop();
        send.mockClear();

        reporter.aired(item(SILENT, 'track-9'), 2_000);

        expect(send).not.toHaveBeenCalled();
    });
});
