import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { UsersService } from '#src/modules/users/users.service.js';
import { UserDetail, UserPage, UserQueryInput, UserRoleChange, UserSummary } from '../modules/users/types/users.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [users.ck](../../data/contracts/users/users.ck)
 */
export const UsersRouter = ServerKitRouter();

/**
 * The station's people, one page at a time, ordered by when their account was made
 * from [users.ck](../../data/contracts/users/users.ck) `GET /users`
 */
UsersRouter.get('/users', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const query = await parseAndValidate(ctx.query, UserQueryInput.strict());

    const service = ctx.container.get(UsersService);
    const result: UserPage = await service.list(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One person, with every way they sign in, where they are signed in and their recent sign-ins
 * from [users.ck](../../data/contracts/users/users.ck) `GET /users/{id}`
 */
UsersRouter.get('/users/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(UsersService);
    const result: UserDetail = await service.get(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Give a person a different role. They hold exactly one, so the role they had is taken away. Refused for your own account, and for the last admin
 * from [users.ck](../../data/contracts/users/users.ck) `PUT /users/{id}/role`
 */
UsersRouter.put('/users/:id/role', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, UserRoleChange);

    const service = ctx.container.get(UsersService);
    const result: UserSummary = await service.changeRole(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Switch a person off. They are signed out everywhere and cannot sign in, and their API keys, connected apps and chat links stop working, until they are switched back on. Nothing is deleted. Refused for your own account, and for the last admin
 * from [users.ck](../../data/contracts/users/users.ck) `POST /users/{id}/deactivate`
 */
UsersRouter.post('/users/:id/deactivate', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(UsersService);
    const result: UserSummary = await service.deactivate(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Switch a person back on. They sign in as they did before, and their API keys, connected apps and chat links work again
 * from [users.ck](../../data/contracts/users/users.ck) `POST /users/{id}/reactivate`
 */
UsersRouter.post('/users/:id/reactivate', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(UsersService);
    const result: UserSummary = await service.reactivate(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Sign a person out everywhere. They can sign straight back in
 * from [users.ck](../../data/contracts/users/users.ck) `POST /users/{id}/sign-out`
 */
UsersRouter.post('/users/:id/sign-out', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(UsersService);
    await service.signOut(id);

    ctx.status = 204;
});

/**
 * Remove a person's authenticator apps and passkeys and sign them out everywhere, for when they have lost the device. They sign in with their password and set a new one up
 * from [users.ck](../../data/contracts/users/users.ck) `POST /users/{id}/mfa/reset`
 */
UsersRouter.post('/users/:id/mfa/reset', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(UsersService);
    await service.resetMfa(id);

    ctx.status = 204;
});
