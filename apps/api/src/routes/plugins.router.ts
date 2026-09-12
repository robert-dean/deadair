import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PluginInstallService } from '#src/modules/plugins/plugin.install.service.js';
import { PluginsService } from '#src/modules/plugins/plugins.service.js';
import {
    PluginConfigInput,
    PluginDetail,
    PluginFieldSuggestions,
    PluginGrantInput,
    PluginGrantList,
    PluginImportResult,
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
import { MultipartBody } from '@maroonedsoftware/multipart';

/**
 * generated from [plugins.ck](../../data/contracts/plugins/plugins.ck)
 */
export const PluginsRouter = ServerKitRouter();

/**
 * Lists every plugin the host knows about
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L28)
 */
PluginsRouter.get('/plugins', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(PluginsService);
    const result: PluginSummary[] = await service.listPlugins();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Every capability an installed plugin is asking the operator for, with the answer so far
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L46)
 */
PluginsRouter.get('/plugins/grants', requirePolicy({ policy: 'platform.view' }), async ctx => {
    const service = ctx.container.get(PluginsService);
    const result: PluginGrantList = await service.listGrants();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Rescans the mounted plugin directory: registers new plugins, unloads removed ones
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L64)
 */
PluginsRouter.post('/plugins/rescan', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const service = ctx.container.get(PluginsService);
    const result: PluginSummary[] = await service.rescanPlugins();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Takes a plugin in from the browser as the tarball npm pack writes and puts it in the plugins directory. It lands disabled, and a newer version of an installed plugin replaces the older one
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L77)
 */
PluginsRouter.post('/plugins/import', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['multipart']), async ctx => {
    const multipartBody = ctx.parsedBody as MultipartBody;

    const service = ctx.container.get(PluginInstallService);
    const result: PluginImportResult = await service.importPlugin(multipartBody);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * One plugin, including its stored non-secret configuration and last error
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L103)
 */
PluginsRouter.get('/plugins/:id', requirePolicy({ policy: 'platform.view' }), async ctx => {
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
 * Removes a plugin the operator installed: stops it and deletes its folder. Its settings are kept, so importing it again brings them back. A bundled plugin is refused
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L118)
 */
PluginsRouter.delete('/plugins/:id', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const service = ctx.container.get(PluginInstallService);
    const result: PluginSummary[] = await service.removePlugin(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Validates against the plugin's own config schema, encrypts secrets, persists, and reinitializes
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L135)
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
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L153)
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
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L168)
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
 * Answers one capability this plugin asked for. Takes effect on the next fetch, with no reload
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L183)
 */
PluginsRouter.put('/plugins/:id/grants', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, PluginGrantInput);

    const service = ctx.container.get(PluginsService);
    const result: PluginGrantList = await service.decideGrant(id, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Reapplies the plugin's stored configuration: disposes the running instance and initializes it again
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L201)
 */
PluginsRouter.post('/plugins/:id/reload', requirePolicy({ policy: 'platform.manage' }), async ctx => {
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
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L216)
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
 * Asks the plugin what to offer for its config fields right now, through the invoker
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L231)
 */
PluginsRouter.post('/plugins/:id/config/suggestions', requirePolicy({ policy: 'platform.manage' }), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.string().min(1).max(200),
        }),
    );

    const service = ctx.container.get(PluginsService);
    const result: PluginFieldSuggestions = await service.suggestPluginConfigOptions(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * Returns the plugin's buffered log lines at or above the current log level
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L250)
 */
PluginsRouter.get('/plugins/:id/logs', requirePolicy({ policy: 'platform.manage' }), async ctx => {
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
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L266)
 */
PluginsRouter.get('/plugins/:id/logs/download', requirePolicy({ policy: 'platform.manage' }), async ctx => {
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
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L284)
 */
PluginsRouter.put('/plugins/:id/logs/level', requirePolicy({ policy: 'platform.manage' }), bodyParserMiddleware(['json']), async ctx => {
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
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L302)
 */
PluginsRouter.get('/plugins/:id/oauth/authorize', requirePolicy({ policy: 'platform.manage' }), async ctx => {
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
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L320)
 */
PluginsRouter.delete('/plugins/:id/oauth', requirePolicy({ policy: 'platform.manage' }), async ctx => {
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
 * from [plugins.ck](../../data/contracts/plugins/plugins.ck#L335)
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
