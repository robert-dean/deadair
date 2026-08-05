import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PluginsService } from '#src/modules/plugins/plugins.service.js';
import {
    PluginConfigInput,
    PluginDetail,
    PluginListQuery,
    PluginLogLevelInput,
    PluginLogPage,
    PluginLogQuery,
    PluginOAuthCallbackQuery,
    PluginOAuthResult,
    PluginOAuthStart,
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
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L11)
 */
PluginsRouter.get('/plugins', requirePolicy({ policy: false }), async ctx => {
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
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L46)
 */
PluginsRouter.get('/plugins/:id', requirePolicy({ policy: false }), async ctx => {
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
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L64)
 */
PluginsRouter.put('/plugins/:id/config', requirePolicy({ policy: false }), bodyParserMiddleware(['json']), async ctx => {
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
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L85)
 */
PluginsRouter.post('/plugins/:id/enable', requirePolicy({ policy: false }), async ctx => {
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
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L103)
 */
PluginsRouter.post('/plugins/:id/disable', requirePolicy({ policy: false }), async ctx => {
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
 * Reapplies the plugin's stored configuration: disposes the running instance and initializes it again
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L121)
 */
PluginsRouter.post('/plugins/:id/reload', requirePolicy({ policy: false }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const service = ctx.container.get(PluginsService);
    const result: PluginDetail = await service.reloadPlugin(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Runs the plugin's own `testConnection()` through the invoker
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L139)
 */
PluginsRouter.post('/plugins/:id/test', requirePolicy({ policy: false }), async ctx => {
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
 * Returns the plugin's buffered log lines at or above the current log level
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L157)
 */
PluginsRouter.get('/plugins/:id/logs', requirePolicy({ policy: false }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const query = await parseAndValidate(ctx.query, PluginLogQuery.strict());

    const service = ctx.container.get(PluginsService);
    const result: PluginLogPage = await service.getPluginLogs(id, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Streams the plugin's full retained log as a plain-text attachment
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L176)
 */
PluginsRouter.get('/plugins/:id/logs/download', requirePolicy({ policy: false }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const service = ctx.container.get(PluginsService);
    const result: { body: string; headers: { contentDisposition?: string } } = await service.downloadPluginLogs(id);

    ctx.status = 200;
    if (result.headers['contentDisposition'] !== undefined) ctx.set('Content-Disposition', String(result.headers['contentDisposition']));
    ctx.type = 'text/plain';
    ctx.body = result.body;
});

/**
 * Sets the minimum severity the plugin's log store retains going forward
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L197)
 */
PluginsRouter.put('/plugins/:id/logs/level', requirePolicy({ policy: false }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PluginLogLevelInput);

    const service = ctx.container.get(PluginsService);
    const result: PluginDetail = await service.setPluginLogLevel(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Reports where to send the operator for the provider's consent screen
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L218)
 */
PluginsRouter.get('/plugins/:id/oauth/authorize', requirePolicy({ policy: false }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const service = ctx.container.get(PluginsService);
    const result: PluginOAuthStart = await service.startOAuthAuthorization(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Forgets the plugin's stored OAuth tokens and reinitializes it
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L239)
 */
PluginsRouter.delete('/plugins/:id/oauth', requirePolicy({ policy: false }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const service = ctx.container.get(PluginsService);
    const result: PluginDetail = await service.disconnectOAuth(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Completes the flow. Anonymous: the provider redirects the browser here with no session of ours
 * from [plugins.ck](file://./../../data/contracts/plugins/plugins.ck#L257)
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
