// The parent link is only worth having if it cannot be forgotten, and there are twenty-odd `send`
// calls across the director, the render pipeline and the enrichment walk. A missing edge looks
// exactly like a root, so a call site that forgot would be silently wrong rather than broken.
//
// Hence a broker that stamps rather than a convention that asks. What is tested here is that the
// override reaches `super.send` with the stamp on, that `schedule` is deliberately NOT stamped, and
// that a plain `PgBossJobBroker` is still what it delegates to.

import { describe, expect, it, vi } from 'vitest';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';

import { PARENT_TRACE_KEY } from '../../../src/modules/jobs/job.trace.payload.js';
import { TracingJobBroker } from '../../../src/modules/jobs/tracing.job.broker.js';
import { runInTrace } from '../../../src/modules/shared/trace.context.js';

/** A broker whose base `send`/`schedule` record rather than reaching pg-boss. */
function build() {
    const sent: { name: string; payload: object }[] = [];
    const scheduled: { name: string; payload?: object }[] = [];
    const broker = new TracingJobBroker(undefined as never, undefined as never, undefined as never);

    vi.spyOn(PgBossJobBroker.prototype, 'send').mockImplementation(async (name: string, payload: object) => {
        sent.push({ name, payload });
        return 'job-new';
    });
    vi.spyOn(PgBossJobBroker.prototype, 'schedule').mockImplementation(async (name: string, _cron: string, payload?: object) => {
        scheduled.push({ name, ...(payload === undefined ? {} : { payload }) });
    });

    return { broker, sent, scheduled };
}

describe('TracingJobBroker', () => {
    it('stamps the decision doing the enqueueing, without the call site asking', async () => {
        const { broker, sent } = build();

        await runInTrace({ id: 'job-parent', kind: 'catalog.enrich' }, async () => {
            await broker.send('catalog.extract_facts', { trackId: 't1' });
        });

        expect(sent).toEqual([{ name: 'catalog.extract_facts', payload: { trackId: 't1', [PARENT_TRACE_KEY]: 'job-parent' } }]);
    });

    it('sends an unstamped payload outside a trace', async () => {
        // Boot scheduling, which is a root and must stay one.
        const { broker, sent } = build();

        await broker.send('catalog.sync', { pluginId: 'deadair.spotify' });

        expect(sent).toEqual([{ name: 'catalog.sync', payload: { pluginId: 'deadair.spotify' } }]);
    });

    it('still answers with the id its base gave', async () => {
        const { broker } = build();

        await expect(broker.send('catalog.sync', {})).resolves.toBe('job-new');
    });

    it('never stamps a schedule, because a cron row outlives the decision that wrote it', async () => {
        // The one case where a parent would be actively wrong: the row is written once at boot and
        // fires forever, so an edge on it would name that boot on every run for as long as it lives.
        const { broker, scheduled } = build();

        await runInTrace({ id: 'job-boot', kind: 'startup' }, async () => {
            await broker.schedule('catalog.sync', '0 * * * *', { pluginId: 'deadair.spotify' });
        });

        expect(scheduled).toEqual([{ name: 'catalog.sync', payload: { pluginId: 'deadair.spotify' } }]);
    });

    it('is a PgBossJobBroker, so both DI tokens can point at it', async () => {
        // The jobs module registers it under `PgBossJobBroker` as well as `JobBroker`, which is what
        // lets the twenty callers typed against the concrete class get it untouched.
        const { broker } = build();

        expect(broker).toBeInstanceOf(PgBossJobBroker);
    });
});
