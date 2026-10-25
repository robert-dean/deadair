import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { BreakKindFileService } from '#src/modules/director/break.kind.file.service.js';
import { BreakKindsService } from '#src/modules/director/break.kinds.service.js';
import {
    BreakKindFile,
    BreakKindImportPlan,
    BreakKindImportResult,
    BreakKindInput,
    BreakKindList,
} from '../modules/director/types/break.kinds.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [break.kinds.ck](../../data/contracts/director/break.kinds.ck)
 */
export const BreakKindsRouter = ServerKitRouter();

/**
 * Every kind of break you have written, switched on or not, in your own order
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `GET /breaks/kinds`
 */
BreakKindsRouter.get('/breaks/kinds', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(BreakKindsService);
    const result: BreakKindList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Writes a new kind of break. Nothing airs it until it is switched on and a band on the format clock names it
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `POST /breaks/kinds`
 */
BreakKindsRouter.post('/breaks/kinds', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, BreakKindInput);

    const service = ctx.container.get(BreakKindsService);
    const result: BreakKindList = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rewrites one kind of break. Its key cannot change. A break already written keeps the words it was given
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `PUT /breaks/kinds/{id}`
 */
BreakKindsRouter.put('/breaks/kinds/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, BreakKindInput);

    const service = ctx.container.get(BreakKindsService);
    const result: BreakKindList = await service.update(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a kind of break. Refused while a band on the format clock still names it
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `DELETE /breaks/kinds/{id}`
 */
BreakKindsRouter.delete('/breaks/kinds/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(BreakKindsService);
    const result: BreakKindList = await service.remove(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every kind of break you have written, as one file
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `GET /breaks/kinds/export`
 */
BreakKindsRouter.get('/breaks/kinds/export', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(BreakKindFileService);
    const result: { body: BreakKindFile; headers: { contentDisposition?: string } } = await service.exportAll();

    ctx.status = 200;
    if (result.headers['contentDisposition'] !== undefined) ctx.set('Content-Disposition', String(result.headers['contentDisposition']));
    ctx.type = 'application/json';
    ctx.body = result.body;
});

/**
 * One kind of break, as a file
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `GET /breaks/kinds/{id}/export`
 */
BreakKindsRouter.get('/breaks/kinds/:id/export', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(BreakKindFileService);
    const result: { body: BreakKindFile; headers: { contentDisposition?: string } } = await service.exportOne(id);

    ctx.status = 200;
    if (result.headers['contentDisposition'] !== undefined) ctx.set('Content-Disposition', String(result.headers['contentDisposition']));
    ctx.type = 'application/json';
    ctx.body = result.body;
});

/**
 * Reads a file and reports what importing it would create, rewrite, skip and refuse. Writes nothing
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `POST /breaks/kinds/import/preview`
 */
BreakKindsRouter.post('/breaks/kinds/import/preview', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const query = await parseAndValidate(
        ctx.query,
        z.strictObject({
            replace: z
                .preprocess(v => (typeof v === 'string' ? v.split(',') : v), z.array(z.string().min(1).max(60)))
                .optional()
                .describe('Keys of kinds this station already holds that the import should rewrite. Every other one it holds is skipped'),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, BreakKindFile);

    const service = ctx.container.get(BreakKindFileService);
    const result: BreakKindImportPlan = await service.preview(body, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Writes a file into this station and answers with what it did. Every kind it writes arrives switched off
 * from [break.kinds.ck](../../data/contracts/director/break.kinds.ck) `POST /breaks/kinds/import`
 */
BreakKindsRouter.post('/breaks/kinds/import', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const query = await parseAndValidate(
        ctx.query,
        z.strictObject({
            replace: z
                .preprocess(v => (typeof v === 'string' ? v.split(',') : v), z.array(z.string().min(1).max(60)))
                .optional()
                .describe('Keys of kinds this station already holds that the file should rewrite'),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, BreakKindFile);

    const service = ctx.container.get(BreakKindFileService);
    const result: BreakKindImportResult = await service.import(body, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
