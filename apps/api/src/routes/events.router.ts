import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { EventDestinationsService } from '#src/modules/events/event.destinations.service.js';
import {
    EventDeliveryList,
    EventDestination,
    EventDestinationCreate,
    EventDestinationCreated,
    EventDestinationList,
    EventDestinationSecret,
    EventDestinationUpdate,
    EventTestResult,
    EventTypeList,
} from '../modules/events/types/events.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [events.ck](../../data/contracts/events/events.ck)
 */
export const EventsRouter = ServerKitRouter();

/**
 * Every kind of event the station sends, each with an example of what a destination receives
 * from [events.ck](../../data/contracts/events/events.ck) `GET /events/types`
 */
EventsRouter.get('/events/types', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(EventDestinationsService);
    const result: EventTypeList = await service.listTypes();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every event destination, oldest first
 * from [events.ck](../../data/contracts/events/events.ck) `GET /events/destinations`
 */
EventsRouter.get('/events/destinations', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(EventDestinationsService);
    const result: EventDestinationList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Add an event destination. The answer carries its signing secret, which is not shown again
 * from [events.ck](../../data/contracts/events/events.ck) `POST /events/destinations`
 */
EventsRouter.post('/events/destinations', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, EventDestinationCreate);

    const service = ctx.container.get(EventDestinationsService);
    const result: EventDestinationCreated = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Change an event destination's name, address, or whether it is on
 * from [events.ck](../../data/contracts/events/events.ck) `PATCH /events/destinations/{id}`
 */
EventsRouter.patch('/events/destinations/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, EventDestinationUpdate);

    const service = ctx.container.get(EventDestinationsService);
    const result: EventDestination = await service.update(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Remove an event destination and its delivery log
 * from [events.ck](../../data/contracts/events/events.ck) `DELETE /events/destinations/{id}`
 */
EventsRouter.delete('/events/destinations/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(EventDestinationsService);
    await service.remove(id);

    ctx.status = 204;
});

/**
 * Make a new signing secret for a destination. The old one stops working at once
 * from [events.ck](../../data/contracts/events/events.ck) `POST /events/destinations/{id}/secret`
 */
EventsRouter.post('/events/destinations/:id/secret', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(EventDestinationsService);
    const result: EventDestinationSecret = await service.rotateSecret(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Send a destination a test event now, and say what it answered. Sent even when the destination is off
 * from [events.ck](../../data/contracts/events/events.ck) `POST /events/destinations/{id}/test`
 */
EventsRouter.post('/events/destinations/:id/test', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(EventDestinationsService);
    const result: EventTestResult = await service.test(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * A destination's latest delivery attempts, newest first
 * from [events.ck](../../data/contracts/events/events.ck) `GET /events/destinations/{id}/deliveries`
 */
EventsRouter.get('/events/destinations/:id/deliveries', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(EventDestinationsService);
    const result: EventDeliveryList = await service.listDeliveries(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
