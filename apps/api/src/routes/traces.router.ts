import { z } from 'zod';
import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { TracesService } from '#src/modules/station/traces.service.js';
import { TraceDetail, TracesPage, TracesQuery } from '../modules/station/types/traces.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [traces.ck](../../data/contracts/station/traces.ck)
 */
export const TracesRouter = ServerKitRouter();

/**
 * Recent decisions, newest first, folded to one row each
 * from [traces.ck](../../data/contracts/station/traces.ck#L27)
 */
TracesRouter.get('/traces', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const query = await parseAndValidate(ctx.query, TracesQuery.strict());

    const service = ctx.container.get(TracesService);
    const result: TracesPage = await service.readTraces(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One decision: every call it made, and the decisions on either side of it
 * from [traces.ck](../../data/contracts/station/traces.ck#L43)
 */
TracesRouter.get('/traces/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200).describe('The job or request id. A unique prefix is enough'),
        }),
    );

    const service = ctx.container.get(TracesService);
    const result: TraceDetail = await service.readTrace(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
