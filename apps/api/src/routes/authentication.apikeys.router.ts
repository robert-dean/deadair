import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { ApiKeysService } from '#src/modules/authentication/api.keys.service.js';
import { ApiKeyCreate, ApiKeyIssued, ApiKeyList } from '../modules/authentication/types/authentication.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [authentication.apikeys.ck](../../data/contracts/authentication/authentication.apikeys.ck)
 */
export const AuthenticationApikeysRouter = ServerKitRouter();

/**
 * The signed-in account's API keys, newest first, including revoked and expired ones so the list says what was withdrawn and when
 * from [authentication.apikeys.ck](../../data/contracts/authentication/authentication.apikeys.ck#L19)
 */
AuthenticationApikeysRouter.get('/auth/apikeys', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(ApiKeysService);
    const result: ApiKeyList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Issue a new API key for the signed-in account. The token is in this response and nowhere else, ever. Once the account has a strong second factor, this needs one verified in the last five minutes
 * from [authentication.apikeys.ck](../../data/contracts/authentication/authentication.apikeys.ck#L28)
 */
AuthenticationApikeysRouter.post('/auth/apikeys', requirePolicy({ policy: 'platform.view' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, ApiKeyCreate);

    const service = ctx.container.get(ApiKeysService);
    const result: ApiKeyIssued = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Give a key a new token, so the old one stops working at once. The key keeps its name, scopes and expiry. Needs the same recent second factor as creating one
 * from [authentication.apikeys.ck](../../data/contracts/authentication/authentication.apikeys.ck#L46)
 */
AuthenticationApikeysRouter.post('/auth/apikeys/:id/rotate', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(ApiKeysService);
    const result: ApiKeyIssued = await service.rotate(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Revoke a key. Every request made with it is refused from the next one on. The key stays in the list, marked revoked
 * from [authentication.apikeys.ck](../../data/contracts/authentication/authentication.apikeys.ck#L61)
 */
AuthenticationApikeysRouter.delete('/auth/apikeys/:id', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(ApiKeysService);
    await service.revoke(id);

    ctx.status = 204;
});
