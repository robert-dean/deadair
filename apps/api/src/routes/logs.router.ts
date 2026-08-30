import { z } from 'zod';
import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { LogsService } from '#src/modules/station/logs.service.js';
import { LogPage, LogQuery, LogSourceList } from '../modules/station/types/logs.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [logs.ck](file://./../../data/contracts/station/logs.ck)
 */
export const LogsRouter = ServerKitRouter();

/**
 * Every log this install has, present or not, with its size and when it was last written
 * from [logs.ck](file://./../../data/contracts/station/logs.ck#L42)
 */
LogsRouter.get('/logs', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(LogsService);
    const result: LogSourceList = await service.listSources();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * A tail of one log, newest first
 * from [logs.ck](file://./../../data/contracts/station/logs.ck#L57)
 */
LogsRouter.get('/logs/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(40),
        }),
    );

    const query = await parseAndValidate(ctx.query, LogQuery.strict());

    const service = ctx.container.get(LogsService);
    const result: LogPage = await service.readLog(id, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The retained log as a plain-text attachment, oldest first, as the file is written
 * from [logs.ck](file://./../../data/contracts/station/logs.ck#L74)
 */
LogsRouter.get('/logs/:id/download', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(40),
        }),
    );

    const service = ctx.container.get(LogsService);
    const result: { body: string; headers: { contentDisposition?: string } } = await service.downloadLog(id);

    ctx.status = 200;
    if (result.headers['contentDisposition'] !== undefined) ctx.set('Content-Disposition', String(result.headers['contentDisposition']));
    ctx.type = 'text/plain';
    ctx.body = result.body;
});
