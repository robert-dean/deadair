import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PluginsService } from '#src/modules/plugins/plugins.service.js';
import {
    PluginConfigInput,
    PluginDetail,
    PluginListQuery,
    PluginOAuthCallbackQuery,
    PluginOAuthResult,
    PluginSummary,
    PluginTestResult,
} from '../modules/plugins/types/plugins.types.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck)
 */
export const PluginsRouter = ServerKitRouter();

/**
 * Lists every plugin the host knows about, optionally narrowed to one kind
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L14)
 */
PluginsRouter.get('/plugins', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const query = await parseAndValidate(ctx.query, PluginListQuery.strict());

    const service = ctx.container.get(PluginsService);
    const result: PluginSummary[] = await service.listPlugins(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rescans the mounted plugin directory: registers new plugins, unloads removed ones
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L28)
 */
PluginsRouter.post('/plugins/rescan', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PluginsService);
    const result: PluginSummary[] = await service.rescanPlugins();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One plugin, including its stored non-secret configuration and last error
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L43)
 */
PluginsRouter.get('/plugins/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const service = ctx.container.get(PluginsService);
    const result: PluginDetail = await service.getPlugin(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Validates against the plugin's own config schema, encrypts secrets, persists, and reinitializes
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L58)
 */
PluginsRouter.put('/plugins/:id/config', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PluginConfigInput);

    const service = ctx.container.get(PluginsService);
    const result: PluginDetail = await service.updatePluginConfig(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Enables a plugin without resubmitting its configuration
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L76)
 */
PluginsRouter.post('/plugins/:id/enable', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const service = ctx.container.get(PluginsService);
    const result: PluginDetail = await service.enablePlugin(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Disables a plugin and tears its instance down, keeping its configuration
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L91)
 */
PluginsRouter.post('/plugins/:id/disable', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const service = ctx.container.get(PluginsService);
    const result: PluginDetail = await service.disablePlugin(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Runs the plugin's own `testConnection()` through the invoker
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L106)
 */
PluginsRouter.post('/plugins/:id/test', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const service = ctx.container.get(PluginsService);
    const result: PluginTestResult = await service.testPlugin(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Redirects the operator to the provider's consent screen
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L121)
 */
PluginsRouter.get('/plugins/:id/oauth/authorize', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const service = ctx.container.get(PluginsService);
    const result: { headers: { location?: string } } = await service.startOAuthAuthorization(id);

    ctx.status = 302;
    if (result.headers['location'] !== undefined) ctx.set('Location', String(result.headers['location']));
});

/**
 * Completes the flow. Anonymous: the provider redirects the browser here with no session of ours
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L140)
 * anonymous access, no security required
 */
PluginsRouter.get('/plugins/:id/oauth/callback', async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const query = await parseAndValidate(ctx.query, PluginOAuthCallbackQuery.strict());

    const service = ctx.container.get(PluginsService);
    const result: PluginOAuthResult = await service.completeOAuthCallback(id, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
