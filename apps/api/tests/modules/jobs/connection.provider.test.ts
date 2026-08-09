// Which connection provider the ROOT container hands out, which decides whether anything outside a
// request can enqueue a job at all.
//
// This is a one-line registration and it was wrong for a long time without anybody noticing, because
// the failure is invisible from the request path — where the middleware overrides it — and silent
// off it. The director asks for a refill when a lineup runs short, off the request path, and that
// send threw every time: a station that reached the end of its programming stayed there.

import { describe, expect, it } from 'vitest';
import { KyselyTransactionConnectionProvider, PgBossConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';

describe('the root job connection provider', () => {
    // `undefined` is pg-boss's own documented "use your own pool". A non-request caller needs
    // exactly that, because there is no transaction for it to join.
    it('answers with no executor, meaning pg-boss uses its own pool', () => {
        expect(new PgBossConnectionProvider().executor()).toBeUndefined();
    });

    // The subclass is what audit.context.middleware installs per request, constructed with the live
    // transaction. Constructed WITHOUT one — which is what registering it at the root does — it
    // throws, and that throw is the whole bug.
    it('throws when the transaction-bound one is built with no transaction', () => {
        const provider = new KyselyTransactionConnectionProvider(undefined as never);

        expect(() => provider.executor()).toThrow();
    });
});
