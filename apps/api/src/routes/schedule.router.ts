import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { ScheduleService } from '#src/modules/schedule/schedule.service.js';
import { SlotAirService } from '#src/modules/director/slot.air.service.js';
import { SlotPlaylistService } from '#src/modules/director/slot.playlist.service.js';
import {
    ScheduleNow,
    ScheduleSlotApplied,
    ScheduleSlotInput,
    ScheduleSlotList,
    ScheduleTimetable,
    ScheduleTimetableQuery,
    SlotPlaylistPosition,
} from '../modules/schedule/types/schedule.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [schedule.ck](../../data/contracts/schedule/schedule.ck)
 */
export const ScheduleRouter = ServerKitRouter();

/**
 * Every slot in this station's schedule, earliest in the day first
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `GET /schedule`
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
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `POST /schedule`
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
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `GET /schedule/current`
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
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `GET /schedule/timetable`
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
 * Rewrites a slot. Takes effect at its next boundary rather than immediately; to change the show on air too, when it is this slot's, apply the slot afterwards with `POST /schedule/{id}/apply`
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `PUT /schedule/{id}`
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
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `DELETE /schedule/{id}`
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

/**
 * Applies a slot, as it is saved now, to the show on air, which must be that slot's. Its name, brief, period, moods, rules and host change in place and the broadcast carries on; the records still planned are chosen again against the new programme, and the ones already planned keep playing until the new set is ready. A change to its source, mode, end or co-hosts cannot be made mid-show and waits for the slot's next occurrence
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `POST /schedule/{id}/apply`
 */
ScheduleRouter.post('/schedule/:id/apply', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(SlotAirService);
    const result: ScheduleSlotApplied = await service.apply(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * The record a slot that resumes its playlist will open on next time, or nothing when it would start from the top
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `GET /schedule/{id}/playlist-position`
 */
ScheduleRouter.get('/schedule/:id/playlist-position', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(SlotPlaylistService);
    const result: SlotPlaylistPosition = await service.position(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Forgets where a slot got to in its playlist, so it starts from the top the next time it opens
 * from [schedule.ck](../../data/contracts/schedule/schedule.ck) `DELETE /schedule/{id}/playlist-position`
 */
ScheduleRouter.delete('/schedule/:id/playlist-position', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(100),
        }),
    );

    const service = ctx.container.get(SlotPlaylistService);
    await service.restart(id);

    ctx.status = 204;
});
