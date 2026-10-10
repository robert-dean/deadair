import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PersonaArtworkService } from '#src/modules/art/persona.artwork.service.js';
import { PersonaPortraitList } from '../modules/art/types/art.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { MultipartBody } from '@maroonedsoftware/multipart';

/**
 * generated from [art.personas.ck](../../data/contracts/art/art.personas.ck)
 */
export const ArtPersonasRouter = ServerKitRouter();

/**
 * Every persona that has a portrait
 * from [art.personas.ck](../../data/contracts/art/art.personas.ck) `GET /art/personas`
 */
ArtPersonasRouter.get('/art/personas', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(PersonaArtworkService);
    const result: PersonaPortraitList = await service.listPortraits();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Puts a picture on a persona. A persona that already had one keeps its URL, so a player holding it picks up the new picture
 * from [art.personas.ck](../../data/contracts/art/art.personas.ck) `POST /art/personas/{personaId}`
 */
ArtPersonasRouter.post('/art/personas/:personaId', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['multipart']), async ctx => {
    const { personaId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            personaId: z.uuid(),
        }),
    );

    const multipartBody = ctx.parsedBody as MultipartBody;

    const service = ctx.container.get(PersonaArtworkService);
    const result: PersonaPortraitList = await service.replacePortrait(personaId, multipartBody);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Takes a persona's picture away. A player shows the record's cover instead
 * from [art.personas.ck](../../data/contracts/art/art.personas.ck) `DELETE /art/personas/{personaId}`
 */
ArtPersonasRouter.delete('/art/personas/:personaId', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { personaId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            personaId: z.uuid(),
        }),
    );

    const service = ctx.container.get(PersonaArtworkService);
    const result: PersonaPortraitList = await service.removePortrait(personaId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
