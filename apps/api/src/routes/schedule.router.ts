import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { ScheduleService } from '#src/modules/schedule/schedule.service.js';
import {
    ScheduleNow,
    ScheduleSlot,
    ScheduleSlotInput,
    ScheduleSlotList,
    ScheduleTimetable,
    ScheduleTimetableQuery,
} from '../modules/schedule/types/schedule.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [schedule.ck](file://./../../data/contracts/schedule/schedule.ck)
 */
export const ScheduleRouter = ServerKitRouter();

/**
 * Every slot in this station's schedule, earliest in the day first
 * from [schedule.ck](file://./../../data/contracts/schedule/schedule.ck#L27)
 */
ScheduleRouter.get('/schedule', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(ScheduleService);
    const result: ScheduleSlotList = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Adds a slot. The station does not change over until its start time comes round
 * from [schedule.ck](file://./../../data/contracts/schedule/schedule.ck#L40)
 */
ScheduleRouter.post('/schedule', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, ScheduleSlotInput);

    const service = ctx.container.get(ScheduleService);
    const result: ScheduleSlotList = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Which slot the clock says should be on, and which one the station is actually airing
 * from [schedule.ck](file://./../../data/contracts/schedule/schedule.ck#L59)
 */
ScheduleRouter.get('/schedule/current', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(ScheduleService);
    const result: ScheduleNow = await service.current();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The station's day as blocks, contiguous and gapless, for drawing
 * from [schedule.ck](file://./../../data/contracts/schedule/schedule.ck#L81)
 */
ScheduleRouter.get('/schedule/timetable', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const query = await parseAndValidate(ctx.query, ScheduleTimetableQuery.strict());

    const service = ctx.container.get(ScheduleService);
    const result: ScheduleTimetable = await service.timetable(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rewrites a slot. Takes effect at its next boundary rather than immediately
 * from [schedule.ck](file://./../../data/contracts/schedule/schedule.ck#L101)
 */
ScheduleRouter.put('/schedule/:id', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, ScheduleSlotInput);

    const service = ctx.container.get(ScheduleService);
    const result: ScheduleSlotList = await service.update(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Removes a slot. Whatever is on air stays on until the next slot begins
 * from [schedule.ck](file://./../../data/contracts/schedule/schedule.ck#L113)
 */
ScheduleRouter.delete('/schedule/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(ScheduleService);
    const result: ScheduleSlotList = await service.remove(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
