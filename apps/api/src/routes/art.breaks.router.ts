import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { BreakArtworkService } from '#src/modules/art/break.artwork.service.js';
import { BreakArtworkList } from '../modules/art/types/art.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { MultipartBody } from '@maroonedsoftware/multipart';

/**
 * generated from [art.breaks.ck](../../data/contracts/art/art.breaks.ck)
 */
export const ArtBreaksRouter = ServerKitRouter();

/**
 * Every kind the station holds a picture for
 * from [art.breaks.ck](../../data/contracts/art/art.breaks.ck#L28)
 */
ArtBreaksRouter.get('/art/breaks', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(BreakArtworkService);
    const result: BreakArtworkList = await service.listBreaks();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Puts an operator's own picture behind a kind of break. The id does not change, so a URL already on the wire keeps working and the ETag is what says the picture moved
 * from [art.breaks.ck](../../data/contracts/art/art.breaks.ck#L49)
 */
ArtBreaksRouter.post('/art/breaks/:kind', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['multipart']), async ctx => {
    const { kind } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            kind: z.string().min(1).max(64),
        }),
    );

    const multipartBody = ctx.parsedBody as MultipartBody;

    const service = ctx.container.get(BreakArtworkService);
    const result: BreakArtworkList = await service.replaceBreak(kind, multipartBody);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Puts the picture this repository ships back. The shipped file is read at this moment rather than copied at install, so an upgrade that improved it is what comes back
 * from [art.breaks.ck](../../data/contracts/art/art.breaks.ck#L70)
 */
ArtBreaksRouter.delete('/art/breaks/:kind', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { kind } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            kind: z.string().min(1).max(64),
        }),
    );

    const service = ctx.container.get(BreakArtworkService);
    const result: BreakArtworkList = await service.revertBreak(kind);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
