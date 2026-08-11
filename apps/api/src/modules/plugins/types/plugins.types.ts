import { z } from 'zod';

/**
 * Lifecycle state of a plugin the host knows about
 * generated from [PluginStatus](file://./../../../../data/contracts/plugins/plugins.types.ck#L7)
 */
export const PluginStatus = z.enum(['discovered', 'disabled', 'misconfigured', 'active', 'failed']);
export type PluginStatus = z.infer<typeof PluginStatus>;

/**
 * generated from [ConfigFieldType](file://./../../../../data/contracts/plugins/plugins.types.ck#L9)
 */
export const ConfigFieldType = z.enum(['string', 'text', 'url', 'secret', 'number', 'boolean', 'select', 'multiselect', 'note']);
export type ConfigFieldType = z.infer<typeof ConfigFieldType>;

/**
 * One choice of a `select` config field
 * generated from [ConfigFieldOption](file://./../../../../data/contracts/plugins/plugins.types.ck#L12)
 */
export const ConfigFieldOption = z.strictObject({
    value: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
});
export type ConfigFieldOption = z.infer<typeof ConfigFieldOption>;

/**
 * generated from [PluginLogLevel](file://./../../../../data/contracts/plugins/plugins.types.ck#L44)
 */
export const PluginLogLevel = z.enum(['debug', 'info', 'warn', 'error']);
export type PluginLogLevel = z.infer<typeof PluginLogLevel>;

/**
 * A submitted settings form. Secret values arrive in here and are never echoed back
 * generated from [PluginConfigInput](file://./../../../../data/contracts/plugins/plugins.types.ck#L76)
 */
export const PluginConfigInput = z.strictObject({
    config: z.record(z.string(), z.unknown()),
});
export type PluginConfigInput = z.infer<typeof PluginConfigInput>;

/**
 * Outcome of the plugin's own `testConnection()`
 * generated from [PluginTestResult](file://./../../../../data/contracts/plugins/plugins.types.ck#L81)
 */
export const PluginTestResult = z.strictObject({
    ok: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    message: z.string().max(4000).optional(),
});
export type PluginTestResult = z.infer<typeof PluginTestResult>;

/**
 * Where the console should send the browser to obtain the operator's consent. Reported rather than
 * redirected to: the route is behind the Bearer floor, so a browser cannot follow a redirect from it
 * generated from [PluginOAuthStart](file://./../../../../data/contracts/plugins/plugins.types.ck#L99)
 */
export const PluginOAuthStart = z.strictObject({
    url: z.url(),
});
export type PluginOAuthStart = z.infer<typeof PluginOAuthStart>;

/**
 * Outcome of an OAuth callback
 * generated from [PluginOAuthResult](file://./../../../../data/contracts/plugins/plugins.types.ck#L104)
 */
export const PluginOAuthResult = z.strictObject({
    pluginId: z.string().min(1).max(200),
    ok: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    message: z.string().max(4000).optional(),
});
export type PluginOAuthResult = z.infer<typeof PluginOAuthResult>;

/**
 * generated from [PluginOAuthCallbackQuery](file://./../../../../data/contracts/plugins/plugins.types.ck#L110)
 */
export const PluginOAuthCallbackQuery = z.object({
    code: z.string().max(2048).optional(),
    state: z.string().max(400).optional(),
    error: z.string().max(400).optional(),
    ubi: z.string().max(400).optional(),
});
export type PluginOAuthCallbackQuery = z.infer<typeof PluginOAuthCallbackQuery>;

/**
 * Mirrors the plugin SDK's `ConfigField`: enough for a console to render the settings form with no per-plugin code
 * generated from [ConfigFieldDescriptor](file://./../../../../data/contracts/plugins/plugins.types.ck#L18)
 */
export const ConfigFieldDescriptor = z.strictObject({
    key: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
    type: ConfigFieldType,
    required: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
    default: z.union([z.string(), z.coerce.number(), z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())]).optional(),
    placeholder: z.string().max(400).optional(),
    help: z.string().max(2000).optional(),
    options: z.array(ConfigFieldOption).optional(),
    dependsOn: z.string().min(1).max(200).optional().describe('Key of the field this one is only relevant to'),
});
export type ConfigFieldDescriptor = z.infer<typeof ConfigFieldDescriptor>;

/**
 * Live choices for a plugin's config fields, keyed by field key, out of the plugin's own
 * `suggestConfigOptions()`. What `ConfigFieldDescriptor.options` cannot be: fixed when the manifest
 * was written, where these are whatever the operator's own server currently says
 * generated from [PluginFieldSuggestions](file://./../../../../data/contracts/plugins/plugins.types.ck#L89)
 */
export const PluginFieldSuggestions = z.strictObject({
    fields: z
        .record(z.string(), z.array(ConfigFieldOption))
        .describe('Keys the plugin had nothing to say about are simply absent, rather than present and empty'),
    supported: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe(
            'False when the plugin does not implement suggestions at all, so a console can tell "nothing to\nsuggest" from "asked and got nothing", and draw a refresh control only where one would do something',
        ),
});
export type PluginFieldSuggestions = z.infer<typeof PluginFieldSuggestions>;

/**
 * generated from [PluginLogEntry](file://./../../../../data/contracts/plugins/plugins.types.ck#L46)
 */
export const PluginLogEntry = z.strictObject({
    ts: z.string().max(40),
    level: PluginLogLevel,
    text: z.string().max(65536).describe('Must match MAX_LINE_BYTES_CEILING in apps/api/src/logging/rotating.log.store.ts. Change both together'),
});
export type PluginLogEntry = z.infer<typeof PluginLogEntry>;

/**
 * generated from [PluginLogQuery](file://./../../../../data/contracts/plugins/plugins.types.ck#L58)
 */
export const PluginLogQuery = z.strictObject({
    limit: z.coerce.number().int().min(1).max(2000).optional(),
    level: PluginLogLevel.optional(),
});
export type PluginLogQuery = z.infer<typeof PluginLogQuery>;

/**
 * generated from [PluginLogLevelInput](file://./../../../../data/contracts/plugins/plugins.types.ck#L63)
 */
export const PluginLogLevelInput = z.strictObject({
    level: PluginLogLevel,
});
export type PluginLogLevelInput = z.infer<typeof PluginLogLevelInput>;

/**
 * A plugin as the settings list sees it. Carries no configured VALUES, only which secrets are set
 * generated from [PluginSummary](file://./../../../../data/contracts/plugins/plugins.types.ck#L31)
 */
export const PluginSummary = z.strictObject({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    version: z.string().min(1).max(100),
    capabilities: z.array(z.string().min(1).max(100)),
    status: PluginStatus,
    enabled: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    description: z.string().max(2000).optional(),
    icon: z.string().max(2000).optional(),
    configFields: z.array(ConfigFieldDescriptor),
    secretsConfigured: z
        .record(
            z.string(),
            z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
        )
        .describe('One entry per `secret` field: whether a value is currently stored. Never the value itself'),
});
export type PluginSummary = z.infer<typeof PluginSummary>;

/**
 * generated from [PluginLogPage](file://./../../../../data/contracts/plugins/plugins.types.ck#L52)
 */
export const PluginLogPage = z.strictObject({
    pluginId: z.string().min(1).max(200),
    level: PluginLogLevel,
    entries: z.array(PluginLogEntry),
});
export type PluginLogPage = z.infer<typeof PluginLogPage>;

/**
 * A summary plus the stored NON-SECRET configuration and the last recorded failure
 * generated from [PluginDetail](file://./../../../../data/contracts/plugins/plugins.types.ck#L68)
 */
export const PluginDetail = PluginSummary.extend({
    config: z.record(z.string(), z.unknown()),
    lastError: z.string().max(4000).optional(),
    oauthConnected: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
    logLevel: PluginLogLevel,
});
export type PluginDetail = z.infer<typeof PluginDetail>;
