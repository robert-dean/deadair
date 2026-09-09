import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PersonaAuditionService } from '#src/modules/personas/persona.audition.service.js';
import { PersonaAudition, PersonaAuditionList, PersonaAuditionRequest, PersonaAuditionSummary } from '../modules/personas/types/personas.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [personas.auditions.ck](../../data/contracts/personas/personas.auditions.ck)
 */
export const PersonasAuditionsRouter = ServerKitRouter();

/**
 * Every audition of this character, newest first, without their breaks
 * from [personas.auditions.ck](../../data/contracts/personas/personas.auditions.ck#L42)
 */
PersonasAuditionsRouter.get('/personas/:id/auditions', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonaAuditionService);
    const result: PersonaAuditionList = await service.list(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Asks the station to put this character through a playlist. It is queued, not written
 * from [personas.auditions.ck](../../data/contracts/personas/personas.auditions.ck#L55)
 */
PersonasAuditionsRouter.post('/personas/:id/auditions', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PersonaAuditionRequest);

    const service = ctx.container.get(PersonaAuditionService);
    const result: PersonaAudition = await service.start(id, body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One audition with every break it has written so far, in order
 * from [personas.auditions.ck](../../data/contracts/personas/personas.auditions.ck#L74)
 */
PersonasAuditionsRouter.get('/personas/:id/auditions/:auditionId', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id, auditionId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
            auditionId: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonaAuditionService);
    const result: PersonaAudition = await service.get(id, auditionId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Stops an audition where it stands, keeping the breaks it has already written
 * from [personas.auditions.ck](../../data/contracts/personas/personas.auditions.ck#L98)
 */
PersonasAuditionsRouter.post('/personas/:id/auditions/:auditionId/cancel', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id, auditionId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
            auditionId: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonaAuditionService);
    const result: PersonaAuditionSummary = await service.cancel(id, auditionId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
