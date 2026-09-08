import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { StorageService } from '#src/modules/storage/storage.service.js';
import { StorageReport } from '../modules/storage/types/storage.types.js';

/**
 * generated from [storage.ck](../../data/contracts/storage/storage.ck)
 */
export const StorageRouter = ServerKitRouter();

/**
 * What is on disk, per store, against what the database says should be
 * from [storage.ck](../../data/contracts/storage/storage.ck#L25)
 */
StorageRouter.get('/storage', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(StorageService);
    const result: StorageReport = await service.readStorage();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
