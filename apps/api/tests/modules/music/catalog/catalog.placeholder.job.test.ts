// `TransactionalJob` has one rule that fails silently when broken: the runner
// constructs the job BEFORE `run`, so a collaborator taken in the constructor
// is built against the pooled `Kysely` and does its work outside the
// transaction the job later opens. Nothing errors — the batch simply is not
// atomic, and a partial failure leaves half the placeholders resolved.
//
// So this asserts the shape rather than the behaviour: nothing is resolved at
// construction time, and the service is fetched only once the override is in
// place.

import { describe, expect, it, vi } from 'vitest';
import { Kysely } from 'kysely';
import { Container } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { PgBossConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';
import { Logger } from '@maroonedsoftware/logger';

import { CatalogPlaceholderJob } from '../../../../src/modules/music/catalog/catalog.placeholder.job.js';
import { CatalogPlaceholderService } from '../../../../src/modules/music/catalog/catalog.placeholder.service.js';
import { AuthorizationContext } from '../../../../src/modules/permissions/authorization.context.js';

/**
 * A scope that records every resolution, in order, and hands back a `Kysely`
 * whose transaction is entered inline. `sql` tagged queries inside the
 * transaction go to a no-op executor.
 */
function fakeScope(service: CatalogPlaceholderService) {
    const resolutions: string[] = [];
    const overrides: string[] = [];

    // Enough of a query executor for the `sql` template in TransactionalJob to
    // run (it asks the transaction for one, compiles, then executes). The audit
    // GUCs it sets are not what is under test here.
    const executor = {
        transformQuery: (node: unknown) => node,
        compileQuery: () => ({ sql: '', parameters: [], query: {} }),
        executeQuery: vi.fn(async () => ({ rows: [] })),
        withPlugins: () => executor,
    };
    const trx = { getExecutor: () => executor };
    const db = { transaction: () => ({ execute: async (fn: (t: unknown) => Promise<void>) => fn(trx) }) };

    const scope = {
        get: vi.fn((token: unknown) => {
            if (token === Kysely) {
                resolutions.push('Kysely');
                return db;
            }
            if (token === JobContext) {
                resolutions.push('JobContext');
                return { id: 'job-1', name: 'catalog.resolve_placeholders', signal: new AbortController().signal };
            }
            if (token === CatalogPlaceholderService) {
                resolutions.push('CatalogPlaceholderService');
                return service;
            }
            if (token === Logger) {
                resolutions.push('Logger');
                return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
            }
            throw new Error(`unexpected resolution: ${String(token)}`);
        }),
        override: vi.fn((token: unknown) => {
            if (token === Kysely) overrides.push('Kysely');
            else if (token === PgBossConnectionProvider) overrides.push('PgBossConnectionProvider');
            else if (token === AuthorizationContext) overrides.push('AuthorizationContext');
        }),
    };

    return { scope: scope as unknown as Container, resolutions, overrides };
}

describe('CatalogPlaceholderJob', () => {
    it('resolves nothing at construction time', async () => {
        const service = { resolvePending: vi.fn(async () => ({ scanned: 0, resolved: 0 })) } as unknown as CatalogPlaceholderService;
        const { scope } = fakeScope(service);

        new CatalogPlaceholderJob(scope);

        expect(scope.get).not.toHaveBeenCalled();
    });

    it('fetches the service only after the transaction overrides are installed', async () => {
        const service = { resolvePending: vi.fn(async () => ({ scanned: 3, resolved: 1 })) } as unknown as CatalogPlaceholderService;
        const { scope, resolutions, overrides } = fakeScope(service);

        await new CatalogPlaceholderJob(scope).run({});

        // The service is built after Kysely has been repointed at the
        // transaction, which is the difference between an atomic batch and a
        // batch that merely looks like one.
        expect(overrides).toEqual(['Kysely', 'PgBossConnectionProvider', 'AuthorizationContext']);
        expect(resolutions.indexOf('CatalogPlaceholderService')).toBeGreaterThan(resolutions.indexOf('Kysely'));
        expect(service.resolvePending).toHaveBeenCalledTimes(1);
    });

    it('passes the cancellation signal through to the service', async () => {
        const service = { resolvePending: vi.fn(async () => ({ scanned: 0, resolved: 0 })) } as unknown as CatalogPlaceholderService;
        const { scope } = fakeScope(service);
        const signal = new AbortController().signal;

        await new CatalogPlaceholderJob(scope).run({}, signal);

        expect(service.resolvePending).toHaveBeenCalledWith(signal);
    });
});
