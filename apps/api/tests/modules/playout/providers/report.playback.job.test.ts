// The job that carries one playback report to the provider: delivered when the plugin still wants
// it, retried only when the plugin says the failure is worth retrying, and dropped otherwise.

import { Container } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PluginError, type PluginManifest } from '@deadair/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';

import { ReportPlaybackJob } from '../../../../src/modules/playout/providers/report.playback.job.js';
import { PluginInvoker } from '../../../../src/modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '../../../../src/modules/plugins/plugin.registry.js';
import type { PluginRecord } from '../../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../../utils/plugin.log.fixture.js';

vi.mock('#modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const PROVIDER = 'deadair.provider';
const REPORT = { event: 'started', startedAt: 1_000 } as const;

const harness = (reportPlayback?: (trackId: string, report: unknown) => Promise<void>) => {
    const manifest = {
        id: PROVIDER,
        name: PROVIDER,
        version: '1.0.0',
        capabilities: ['stream'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [],
        configSchema: { parse: () => ({}), safeParse: () => ({ success: true, data: {} }) },
    } as unknown as PluginManifest;
    const report = reportPlayback === undefined ? undefined : vi.fn(reportPlayback);
    const record: PluginRecord = {
        id: PROVIDER,
        dir: `/plugins/${PROVIDER}`,
        origin: 'bundled',
        status: 'active',
        manifest,
        instance: { init: vi.fn(), resolveStreamUrl: vi.fn(), ...(report === undefined ? {} : { reportPlayback: report }) } as never,
    };
    const registry = new PluginRegistry();
    registry.setAll([record]);

    const info = vi.fn();
    const logger = { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;
    const job = new ReportPlaybackJob(
        registry,
        new PluginInvoker(registry, stubPluginLog().log),
        { id: 'job-1' } as unknown as JobContext,
        {} as unknown as Container,
        logger,
    );

    return { job, report, info };
};

describe('ReportPlaybackJob', () => {
    it('hands the report to the provider that served the copy', async () => {
        const { job, report } = harness(async () => {});

        await job.run({ pluginId: PROVIDER, trackId: 'TR:1', report: REPORT });

        expect(report).toHaveBeenCalledExactlyOnceWith('TR:1', REPORT);
    });

    it('rethrows a failure the provider calls retryable, so the broker tries again', async () => {
        const { job } = harness(async () => {
            throw new PluginError('the service is down').withCode('unavailable');
        });

        await expect(job.run({ pluginId: PROVIDER, trackId: 'TR:1', report: REPORT })).rejects.toThrow();
    });

    it('drops a report the provider will never take', async () => {
        const { job, info } = harness(async () => {
            throw new PluginError('no such play').withCode('not_found');
        });

        await expect(job.run({ pluginId: PROVIDER, trackId: 'TR:1', report: REPORT })).resolves.toBeUndefined();
        expect(info).toHaveBeenCalledWith(expect.stringContaining('will not be asked again'));
    });

    it('does nothing for a provider that no longer wants reports', async () => {
        const { job } = harness();

        await expect(job.run({ pluginId: PROVIDER, trackId: 'TR:1', report: REPORT })).resolves.toBeUndefined();
    });

    it('ignores a payload that is missing its parts', async () => {
        const { job, report } = harness(async () => {});

        await job.run({ pluginId: PROVIDER });

        expect(report).not.toHaveBeenCalled();
    });
});
