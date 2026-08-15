import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PersonasService } from '#src/modules/personas/personas.service.js';
import { Persona, PersonaInput, PersonaList } from '../modules/personas/types/personas.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [personas.ck](file://./../../data/contracts/personas/personas.ck)
 */
export const PersonasRouter = ServerKitRouter();

/**
 * Every persona this station has, oldest first
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L22)
 */
PersonasRouter.get('/personas', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Writes a new persona. It is not put on air by creating it
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L35)
 */
PersonasRouter.post('/personas', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PersonaInput);

    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Writes back whichever of the station's own personas this station is missing, touching nothing it already has and putting nothing on air
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L50)
 */
PersonasRouter.post('/personas/restore', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.restore();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rewrites one persona. An edit to the one on air is heard on the next break
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L65)
 */
PersonasRouter.put('/personas/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PersonaInput);

    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.update(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a persona, including the one on air, which leaves the station with none
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L77)
 */
PersonasRouter.delete('/personas/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.remove(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Puts this persona on air and takes the previous one off
 * from [personas.ck](file://./../../data/contracts/personas/personas.ck#L92)
 */
PersonasRouter.put('/personas/:id/active', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(PersonasService);
    const result: PersonaList = await service.setActive(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
