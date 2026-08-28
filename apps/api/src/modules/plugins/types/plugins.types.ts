import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * Lifecycle state of a plugin the host knows about
 * generated from [PluginStatus](file://./../../../../data/contracts/plugins/plugins.types.ck#L7)
 */
export const PluginStatus = z.enum(['discovered', 'disabled', 'misconfigured', 'active', 'failed']);
export type PluginStatus = z.infer<typeof PluginStatus>;

/**
 * generated from [ConfigFieldType](file://./../../../../data/contracts/plugins/plugins.types.ck#L9)
 */
export const ConfigFieldType = z.enum(['string', 'text', 'url', 'secret', 'number', 'boolean', 'select', 'multiselect', 'list', 'note']);
export type ConfigFieldType = z.infer<typeof ConfigFieldType>;

/**
 * What a `number` field's value is measured in. The stored value is always in this unit; only the
 * control the operator touches changes, so a byte count stays a byte count everywhere it is read and
 * a `fraction` stays the share between 0 and 1 that the code multiplying by it wants
 * generated from [ConfigFieldUnit](file://./../../../../data/contracts/plugins/plugins.types.ck#L14)
 */
export const ConfigFieldUnit = z.enum(['bytes', 'fraction']);
export type ConfigFieldUnit = z.infer<typeof ConfigFieldUnit>;

/**
 * The control a field asks to be drawn with, where the ordinary one for its type reads badly. Opt-in
 * per field rather than inferred from `min`/`max`, because a slider is right for a value you feel for
 * and wrong for one you have to hit exactly. Nothing about the stored value changes
 * generated from [ConfigFieldControl](file://./../../../../data/contracts/plugins/plugins.types.ck#L19)
 */
export const ConfigFieldControl = z.enum(['slider']);
export type ConfigFieldControl = z.infer<typeof ConfigFieldControl>;

/**
 * One choice of a `select` config field
 * generated from [ConfigFieldOption](file://./../../../../data/contracts/plugins/plugins.types.ck#L22)
 */
export const ConfigFieldOption = z.strictObject({
    value: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
});
export type ConfigFieldOption = z.infer<typeof ConfigFieldOption>;

/**
 * Where a column's choices come from when only the station can enumerate them, resolved by the console
 * generated from [ConfigFieldOptionSource](file://./../../../../data/contracts/plugins/plugins.types.ck#L28)
 */
export const ConfigFieldOptionSource = z.enum(['station.newsCategories']);
export type ConfigFieldOptionSource = z.infer<typeof ConfigFieldOptionSource>;

/**
 * generated from [PluginLogLevel](file://./../../../../data/contracts/plugins/plugins.types.ck#L75)
 */
export const PluginLogLevel = z.enum(['debug', 'info', 'warn', 'error']);
export type PluginLogLevel = z.infer<typeof PluginLogLevel>;

/**
 * A submitted settings form. Secret values arrive in here and are never echoed back
 * generated from [PluginConfigInput](file://./../../../../data/contracts/plugins/plugins.types.ck#L107)
 */
export const PluginConfigInput = z.strictObject({
    config: z.record(z.string(), z.unknown()),
});
export type PluginConfigInput = z.infer<typeof PluginConfigInput>;

/**
 * What a plugin may do with a capability it asked for. Denied is the default and needs no row: a
 * capability is refused until somebody allows it, so "never answered" and "refused" are one state
 * generated from [GrantDecision](file://./../../../../data/contracts/plugins/plugins.types.ck#L113)
 */
export const GrantDecision = z.enum(['allowed', 'denied']);
export type GrantDecision = z.infer<typeof GrantDecision>;

/**
 * Outcome of the plugin's own `testConnection()`
 * generated from [PluginTestResult](file://./../../../../data/contracts/plugins/plugins.types.ck#L137)
 */
export const PluginTestResult = z.strictObject({
    ok: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    message: z.string().max(4000).optional(),
});
export type PluginTestResult = z.infer<typeof PluginTestResult>;

/**
 * Where the console should send the browser to obtain the operator's consent. Reported rather than
 * redirected to: the route is behind the Bearer floor, so a browser cannot follow a redirect from it
 * generated from [PluginOAuthStart](file://./../../../../data/contracts/plugins/plugins.types.ck#L155)
 */
export const PluginOAuthStart = z.strictObject({
    url: z.url(),
});
export type PluginOAuthStart = z.infer<typeof PluginOAuthStart>;

/**
 * Outcome of an OAuth callback
 * generated from [PluginOAuthResult](file://./../../../../data/contracts/plugins/plugins.types.ck#L160)
 */
export const PluginOAuthResult = z.strictObject({
    pluginId: z.string().min(1).max(200),
    ok: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    message: z.string().max(4000).optional(),
});
export type PluginOAuthResult = z.infer<typeof PluginOAuthResult>;

/**
 * generated from [PluginOAuthCallbackQuery](file://./../../../../data/contracts/plugins/plugins.types.ck#L166)
 */
export const PluginOAuthCallbackQuery = z.object({
    code: z.string().max(2048).optional(),
    state: z.string().max(400).optional(),
    error: z.string().max(400).optional(),
    ubi: z.string().max(400).optional(),
    token: z
        .string()
        .max(2048)
        .optional()
        .describe(
            "What a desktop-style flow returns instead of `code`: the provider mints a token before the\nconsent screen and hands the same one back, which the plugin exchanges for a session. Last.fm's\nauth works this way. Listed here because the route parses this query strictly, so an\nundeclared parameter is a 400 before any plugin code runs",
        ),
});
export type PluginOAuthCallbackQuery = z.infer<typeof PluginOAuthCallbackQuery>;

/**
 * Live choices for a plugin's config fields, keyed by field key, out of the plugin's own
 * `suggestConfigOptions()`. What `ConfigFieldDescriptor.options` cannot be: fixed when the manifest
 * was written, where these are whatever the operator's own server currently says
 * generated from [PluginFieldSuggestions](file://./../../../../data/contracts/plugins/plugins.types.ck#L145)
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
 * One column of a `list` field. Every cell is stored as a string, so this describes the control rather than the value
 * generated from [ConfigFieldColumn](file://./../../../../data/contracts/plugins/plugins.types.ck#L31)
 */
export const ConfigFieldColumn = z.strictObject({
    key: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
    type: z.enum(['string', 'url', 'select']),
    required: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
    placeholder: z.string().max(400).optional(),
    options: z.array(ConfigFieldOption).optional(),
    optionsFrom: ConfigFieldOptionSource.optional(),
});
export type ConfigFieldColumn = z.infer<typeof ConfigFieldColumn>;

/**
 * generated from [PluginLogEntry](file://./../../../../data/contracts/plugins/plugins.types.ck#L77)
 */
export const PluginLogEntry = z.strictObject({
    ts: z.string().max(40),
    level: PluginLogLevel,
    text: z.string().max(65536).describe('Must match MAX_LINE_BYTES_CEILING in apps/api/src/logging/rotating.log.store.ts. Change both together'),
});
export type PluginLogEntry = z.infer<typeof PluginLogEntry>;

/**
 * generated from [PluginLogQuery](file://./../../../../data/contracts/plugins/plugins.types.ck#L89)
 */
export const PluginLogQuery = z.strictObject({
    limit: z.coerce.number().int().min(1).max(2000).optional(),
    level: PluginLogLevel.optional(),
});
export type PluginLogQuery = z.infer<typeof PluginLogQuery>;

/**
 * generated from [PluginLogLevelInput](file://./../../../../data/contracts/plugins/plugins.types.ck#L94)
 */
export const PluginLogLevelInput = z.strictObject({
    level: PluginLogLevel,
});
export type PluginLogLevelInput = z.infer<typeof PluginLogLevelInput>;

/**
 * One capability a plugin asked for, with the station's answer. The ask is the plugin's manifest and
 * the answer is a row, so a plugin that stops asking stops appearing here whatever was stored
 * generated from [PluginGrant](file://./../../../../data/contracts/plugins/plugins.types.ck#L117)
 */
export const PluginGrant = z.strictObject({
    pluginId: z.string().min(1).max(200),
    pluginName: z.string().min(1).max(200),
    capability: z.string().min(1).max(100).describe("The host's own id for it, e.g. `network.open`"),
    label: z.string().min(1).max(200).describe('What the host calls the capability'),
    describes: z.string().min(1).max(2000).describe("What allowing it opens up, in the station's words"),
    reason: z.string().min(1).max(2000).describe("Why this plugin says it needs it, in the plugin's words"),
    decision: GrantDecision,
});
export type PluginGrant = z.infer<typeof PluginGrant>;

/**
 * generated from [PluginGrantInput](file://./../../../../data/contracts/plugins/plugins.types.ck#L131)
 */
export const PluginGrantInput = z.strictObject({
    capability: z.string().min(1).max(100),
    decision: GrantDecision,
});
export type PluginGrantInput = z.infer<typeof PluginGrantInput>;

/**
 * Mirrors the plugin SDK's `ConfigField`: enough for a console to render the settings form with no per-plugin code
 * generated from [ConfigFieldDescriptor](file://./../../../../data/contracts/plugins/plugins.types.ck#L42)
 */
export const ConfigFieldDescriptor = z.strictObject({
    key: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
    type: ConfigFieldType,
    required: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
    default: z.union([z.string(), z.coerce.number(), z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())]).optional(),
    unit: ConfigFieldUnit.optional().describe('`number` only, and ignored elsewhere'),
    control: ConfigFieldControl.optional().describe('`number` only, and ignored without both `min` and `max`'),
    step: z.coerce.number().optional().describe("How coarsely a `control` moves, in the field's own unit. Ignored without one, and defaults to 1"),
    min: z.coerce.number().optional().describe('`number` only: the smallest value that will be accepted, inclusive'),
    max: z.coerce.number().optional().describe('`number` only: the largest value that will be accepted, inclusive'),
    placeholder: z.string().max(400).optional(),
    help: z.string().max(2000).optional(),
    options: z.array(ConfigFieldOption).optional(),
    columns: z.array(ConfigFieldColumn).optional().describe('`list` only, and ignored elsewhere'),
    dependsOn: z.string().min(1).max(200).optional().describe('Key of the field this one is only relevant to'),
});
export type ConfigFieldDescriptor = z.infer<typeof ConfigFieldDescriptor>;

/**
 * generated from [PluginLogPage](file://./../../../../data/contracts/plugins/plugins.types.ck#L83)
 */
export const PluginLogPage = z.strictObject({
    pluginId: z.string().min(1).max(200),
    level: PluginLogLevel,
    entries: z
        .array(PluginLogEntry)
        .describe('Newest first, as the activity feed and the script history send. The download is the file as written, oldest first'),
});
export type PluginLogPage = z.infer<typeof PluginLogPage>;

/**
 * generated from [PluginGrantList](file://./../../../../data/contracts/plugins/plugins.types.ck#L127)
 */
export const PluginGrantList = z.strictObject({
    grants: z.array(PluginGrant).describe('Every capability every installed plugin is asking for, refused ones included'),
});
export type PluginGrantList = z.infer<typeof PluginGrantList>;

/**
 * A plugin as the settings list sees it. Carries no configured VALUES, only which secrets are set
 * generated from [PluginSummary](file://./../../../../data/contracts/plugins/plugins.types.ck#L61)
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
    firstEnabledAt: _ZodDatetime
        .optional()
        .describe('When this plugin was first ever enabled. Absent means it never has been, so the console asks before it is'),
});
export type PluginSummary = z.infer<typeof PluginSummary>;

export const PluginSummaryInput = z.strictObject({
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
export type PluginSummaryInput = z.infer<typeof PluginSummaryInput>;

/**
 * A summary plus the stored NON-SECRET configuration and the last recorded failure
 * generated from [PluginDetail](file://./../../../../data/contracts/plugins/plugins.types.ck#L99)
 */
export const PluginDetail = PluginSummary.extend({
    config: z.record(z.string(), z.unknown()),
    lastError: z.string().max(4000).optional(),
    oauthConnected: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
    logLevel: PluginLogLevel,
});
export type PluginDetail = z.infer<typeof PluginDetail>;

export const PluginDetailInput = PluginSummaryInput.extend({
    config: z.record(z.string(), z.unknown()),
    lastError: z.string().max(4000).optional(),
    oauthConnected: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
    logLevel: PluginLogLevel,
});
export type PluginDetailInput = z.infer<typeof PluginDetailInput>;
