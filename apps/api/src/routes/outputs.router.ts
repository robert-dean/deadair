import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { OutputsService } from '#src/modules/outputs/outputs.service.js';
import { OutputCast, OutputCastList, OutputCastRequest, OutputDeviceList } from '../modules/outputs/types/outputs.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [outputs.ck](../../data/contracts/outputs/outputs.ck)
 */
export const OutputsRouter = ServerKitRouter();

/**
 * Every speaker the station can play on, from every `output` plugin, with the mounts each can take
 * from [outputs.ck](../../data/contracts/outputs/outputs.ck#L16)
 */
OutputsRouter.get('/outputs/devices', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(OutputsService);
    const result: OutputDeviceList = await service.listDevices();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every speaker the station is meant to be playing on, each asked how it is doing now
 * from [outputs.ck](../../data/contracts/outputs/outputs.ck#L31)
 */
OutputsRouter.get('/outputs/casts', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(OutputsService);
    const result: OutputCastList = await service.listCasts();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Play the station on a speaker, replacing whatever it was playing. The station keeps it playing, through a dropped stream or a restart, until it is stopped here or somebody plays something else on it
 * from [outputs.ck](../../data/contracts/outputs/outputs.ck#L43)
 */
OutputsRouter.post('/outputs/casts', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, OutputCastRequest);

    const service = ctx.container.get(OutputsService);
    const result: OutputCast = await service.startCast(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Stop the station on a speaker. Answers 204 when it was not playing too
 * from [outputs.ck](../../data/contracts/outputs/outputs.ck#L62)
 */
OutputsRouter.delete('/outputs/casts/:pluginId/:deviceId', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { pluginId, deviceId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            pluginId: z.string().min(1).max(200),
            deviceId: z.string().min(1).max(400),
        }),
    );

    const service = ctx.container.get(OutputsService);
    await service.stopCast(pluginId, deviceId);

    ctx.status = 204;
});
