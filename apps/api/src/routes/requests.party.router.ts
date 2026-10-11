import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PartyService } from '#src/modules/requests/party.service.js';
import { PartyGuestSession, PartyJoin, PartyPass, PartyStart, PartyState } from '../modules/requests/types/requests.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [requests.party.ck](../../data/contracts/requests/requests.party.ck)
 */
export const RequestsPartyRouter = ServerKitRouter();

/**
 * The party that is on, with its pass, so the console can show the QR code again
 * from [requests.party.ck](../../data/contracts/requests/requests.party.ck) `GET /party`
 */
RequestsPartyRouter.get('/party', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PartyService);
    const result: PartyState = await service.get();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Start a party. A party already on is ended first, which turns its guests away, so there is only ever one pass to scan
 * from [requests.party.ck](../../data/contracts/requests/requests.party.ck) `POST /party`
 */
RequestsPartyRouter.post('/party', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PartyStart);

    const service = ctx.container.get(PartyService);
    const result: PartyPass = await service.start(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * End the party. Its pass stops working and every guest who joined with it is turned away on their next request
 * from [requests.party.ck](../../data/contracts/requests/requests.party.ck) `DELETE /party`
 */
RequestsPartyRouter.delete('/party', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PartyService);
    await service.end();

    ctx.status = 204;
});

/**
 * Join the party as a guest. Answers 404 for a pass that is unknown, ended or run out, without saying which
 * from [requests.party.ck](../../data/contracts/requests/requests.party.ck) `POST /party/join`
 * anonymous access, no security required
 */
RequestsPartyRouter.post('/party/join', bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PartyJoin);

    const service = ctx.container.get(PartyService);
    const result: PartyGuestSession = await service.join(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});
