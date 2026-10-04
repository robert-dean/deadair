// The rules routes through the real chain, for the one thing a service test cannot see: the ORDER
// they are declared in. `/rules/steer` also matches `/rules/{id}`, whose id is a uuid, so the other
// way round every write to the steer answers 400 from the id check and never runs.

import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import { errorMiddleware } from '@maroonedsoftware/koa';
import { PolicyService } from '@maroonedsoftware/policies';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RulesRouter } from '../../src/routes/rules.router.js';
import { BlockRulesService } from '../../src/modules/director/block.rules.service.js';

// Explicitly, for the reason `art.router.test.ts` gives at length: `listen(0)` on the wildcard is
// flaky under a sandbox that has no route to every interface it binds.
const LOOPBACK = '127.0.0.1';

let server: Server | undefined;

afterEach(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
});

const send = (url: string, method = 'GET'): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
        const req = request(url, { method }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk as Buffer));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
        });
        req.on('error', reject);
        req.end();
    });

/** The rules router, with the policy middleware satisfied and the container stubbed. */
const serve = async (rules: Partial<BlockRulesService>): Promise<string> => {
    const app = new Koa();

    app.use(errorMiddleware() as unknown as Koa.Middleware);
    // `requirePolicy` reads the session off the context and asserts through the container's
    // `PolicyService`. Both are satisfied rather than exercised: which policy each route carries is
    // the contract's business, and this file is about which ROUTER answers.
    const policies = { assert: vi.fn(async () => undefined) };
    app.use(async (ctx, next) => {
        (ctx as unknown as { container: { get: (token: unknown) => unknown } }).container = {
            get: (token: unknown) => (token === BlockRulesService ? rules : policies),
        };
        (ctx as unknown as { authenticationSession: unknown }).authenticationSession = { actor: { id: 'test' } };
        await next();
    });
    app.use(RulesRouter.routes() as unknown as Koa.Middleware);

    server = app.listen(0, LOOPBACK);
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));

    return `http://${LOOPBACK}:${(server!.address() as AddressInfo).port}`;
};

describe('DELETE /rules/steer', () => {
    it('reaches the steer rather than the rule route it shares a shape with', async () => {
        const stopSteering = vi.fn(async () => ({}));
        const remove = vi.fn();
        const base = await serve({ stopSteering, remove });

        const response = await send(`${base}/rules/steer`, 'DELETE');

        expect(response.status).toBe(200);
        expect(stopSteering).toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });
});

describe('DELETE /rules/:id', () => {
    it('still reaches a rule by its id', async () => {
        const remove = vi.fn(async () => ({ rules: [] }));
        const stopSteering = vi.fn();
        const base = await serve({ remove, stopSteering });

        const response = await send(`${base}/rules/11111111-1111-4111-8111-111111111111`, 'DELETE');

        expect(response.status).toBe(200);
        expect(remove).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
        expect(stopSteering).not.toHaveBeenCalled();
    });
});
