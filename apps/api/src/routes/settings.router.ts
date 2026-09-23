import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { SettingsService } from '#src/modules/settings/settings.service.js';
import { SigninProviderCheckService } from '#src/modules/authentication/signin.provider.check.service.js';
import { SigninProvidersCheck, StationSettings, StationSettingsInput } from '../modules/settings/types/settings.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [settings.ck](../../data/contracts/settings/settings.ck)
 */
export const SettingsRouter = ServerKitRouter();

/**
 * Every station setting, its descriptor and its current value
 * from [settings.ck](../../data/contracts/settings/settings.ck#L27)
 */
SettingsRouter.get('/settings', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(SettingsService);
    const result: StationSettings = await service.read();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Applies a submitted settings form and answers with the settings as they now stand
 * from [settings.ck](../../data/contracts/settings/settings.ck#L36)
 */
SettingsRouter.put('/settings', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, StationSettingsInput);

    const service = ctx.container.get(SettingsService);
    const result: StationSettings = await service.writeSubmitted(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Asks each identity provider in the sign-in settings for its discovery document, the way a sign-in would, and says which answered
 * from [settings.ck](../../data/contracts/settings/settings.ck#L56)
 */
SettingsRouter.get('/settings/signin/check', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(SigninProviderCheckService);
    const result: SigninProvidersCheck = await service.check();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
