// EnrichmentRefresh is the subscriber on the other side of `plugin.configured`: a provider's
// settings changing makes what it already stored stale. No database and no plugin registry here —
// it takes a scope with `EnrichmentService` and `EnrichmentRepository` already on it, the shape
// `activity.recorder.test.ts` uses for the same reason (a singleton opening its own scope per call).

import { describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';

import { EnrichmentRefresh } from '../../../src/modules/enrichment/enrichment.refresh.js';
import { EnrichmentRepository } from '../../../src/modules/enrichment/enrichment.repository.js';
import { EnrichmentService } from '../../../src/modules/enrichment/enrichment.service.js';
import { StationBus } from '../../../src/modules/shared/station.bus.js';

const MUSICBRAINZ = 'deadair.musicbrainz';
const SPOTIFY = 'deadair.spotify';

function build(providerIds: string[], expireProvider: (provider: string) => Promise<number> = async () => 3) {
    const enrichment = { providerIds: vi.fn(() => providerIds) };
    const repository = { expireProvider: vi.fn(expireProvider) };
    const scope = {
        get: vi.fn((token: unknown) => (token === EnrichmentService ? enrichment : repository)),
        disposeAsync: vi.fn(async () => {}),
    };
    const container = { createScopedContainer: vi.fn(() => scope) } as unknown as Container;

    const bus = new StationBus({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never);
    const jobs = { send: vi.fn(async () => 'job-1') };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

    const refresh = new EnrichmentRefresh(container, bus, jobs as never, logger);

    return { refresh, bus, jobs, enrichment, repository, scope, logger };
}

/** `StationBus.publish` fans out synchronously but the subscriber's own work is async; give it a tick. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('EnrichmentRefresh', () => {
    it("expires a provider's rows and sends the walk", async () => {
        const { refresh, bus, jobs, repository } = build([MUSICBRAINZ], async () => 5);
        refresh.start();

        bus.publish('plugin.configured', { pluginId: MUSICBRAINZ });
        await flush();

        expect(repository.expireProvider).toHaveBeenCalledWith(MUSICBRAINZ);
        expect(jobs.send).toHaveBeenCalledWith('catalog.enrich', {});
    });

    it('ignores a plugin that does not enrich', async () => {
        const { refresh, bus, jobs, repository } = build([MUSICBRAINZ]);
        refresh.start();

        bus.publish('plugin.configured', { pluginId: SPOTIFY });
        await flush();

        expect(repository.expireProvider).not.toHaveBeenCalled();
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('disposes its scope whichever way the event went', async () => {
        const inScope = build([MUSICBRAINZ]);
        inScope.refresh.start();
        inScope.bus.publish('plugin.configured', { pluginId: MUSICBRAINZ });
        await flush();
        expect(inScope.scope.disposeAsync).toHaveBeenCalledOnce();

        const outOfScope = build([MUSICBRAINZ]);
        outOfScope.refresh.start();
        outOfScope.bus.publish('plugin.configured', { pluginId: SPOTIFY });
        await flush();
        expect(outOfScope.scope.disposeAsync).toHaveBeenCalledOnce();
    });

    it('stop() unsubscribes, so a later event does nothing', async () => {
        const { refresh, bus, jobs } = build([MUSICBRAINZ]);
        refresh.start();
        refresh.stop();

        bus.publish('plugin.configured', { pluginId: MUSICBRAINZ });
        await flush();

        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('a failing expiry is caught and logged, not thrown into the publisher', async () => {
        const { refresh, bus, logger } = build([MUSICBRAINZ], async () => {
            throw new Error('no connection');
        });
        refresh.start();

        expect(() => bus.publish('plugin.configured', { pluginId: MUSICBRAINZ })).not.toThrow();
        await flush();

        expect(logger.warn).toHaveBeenCalledOnce();
    });
});
