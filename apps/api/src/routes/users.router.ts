import { z } from 'zod';
import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { UsersService } from '#src/modules/users/users.service.js';
import { UserDetail, UserPage, UserQueryInput } from '../modules/users/types/users.types.js';
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
