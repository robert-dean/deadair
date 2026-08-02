import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { SettingsService } from '#src/modules/settings/settings.service.js';
import { MusicProvider, MusicProviderInput, MusicProviderKey } from '../modules/settings/types/settings.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [settings.ck](file://./../../data/contracts/settings/settings.ck)
 */
export const SettingsRouter = ServerKitRouter();

/**
 * Retrieves the list of supported music providers
 * from [settings.ck](file://./../../data/contracts/settings/settings.ck#L11)
 */
SettingsRouter.get('/settings/music/providers', requirePolicy(), async ctx => {
    const service = ctx.container.get(SettingsService);
    const result: MusicProvider[] = await service.getMusicProviders();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [settings.ck](file://./../../data/contracts/settings/settings.ck#L26)
 */
SettingsRouter.put('/settings/music/providers/:key', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const { key } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            key: MusicProviderKey,
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, MusicProviderInput);

    const service = ctx.container.get(SettingsService);
    const result: MusicProvider = await service.updateMusicProvider(key, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
