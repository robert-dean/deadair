import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { RequestsService } from '#src/modules/requests/requests.service.js';
import {
    ListenerRequest,
    ListenerRequestCreate,
    ListenerRequestDecline,
    ListenerRequestList,
    RequestStatus,
    RequestableTrackList,
} from '../modules/requests/types/requests.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [requests.ck](../../data/contracts/requests/requests.ck)
 */
export const RequestsRouter = ServerKitRouter();

/**
 * Records the station could be asked to play, matching a title or an artist, then what the music providers carry in the room left
 * from [requests.ck](../../data/contracts/requests/requests.ck) `GET /requests/search`
 */
RequestsRouter.get('/requests/search', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(
        ctx.query,
        z.strictObject({
            q: z.string().min(1).max(200).describe('What to look for: a title, an artist, or both'),
            limit: z
                .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(25))
                .optional()
                .describe('How many to answer with. Ten when omitted'),
        }),
    );

    const service = ctx.container.get(RequestsService);
    const result: RequestableTrackList = await service.search(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every recent request, for the operator deciding on them
 * from [requests.ck](../../data/contracts/requests/requests.ck) `GET /requests`
 */
RequestsRouter.get('/requests', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const query = await parseAndValidate(
        ctx.query,
        z.strictObject({
            status: RequestStatus.optional().describe('Only requests in this state'),
        }),
    );

    const service = ctx.container.get(RequestsService);
    const result: ListenerRequestList = await service.list(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Ask the station to play a record. Answers with the request whatever became of it, so a refusal says why in `reason`
 * from [requests.ck](../../data/contracts/requests/requests.ck) `POST /requests`
 */
RequestsRouter.post('/requests', requirePolicy({ policy: 'platform.view' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, ListenerRequestCreate);

    const service = ctx.container.get(RequestsService);
    const result: ListenerRequest = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The signed-in account's own recent requests
 * from [requests.ck](../../data/contracts/requests/requests.ck) `GET /requests/mine`
 */
RequestsRouter.get('/requests/mine', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(RequestsService);
    const result: ListenerRequestList = await service.mine();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Let a waiting request through. It goes into the running order once its audio is here
 * from [requests.ck](../../data/contracts/requests/requests.ck) `POST /requests/{id}/grant`
 */
RequestsRouter.post('/requests/:id/grant', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(RequestsService);
    const result: ListenerRequest = await service.grant(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Turn a request down. One already in the running order is left there; take it out of the order instead
 * from [requests.ck](../../data/contracts/requests/requests.ck) `POST /requests/{id}/decline`
 */
RequestsRouter.post('/requests/:id/decline', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, ListenerRequestDecline);

    const service = ctx.container.get(RequestsService);
    const result: ListenerRequest = await service.decline(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
