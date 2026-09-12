import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodBinary = z.custom<Buffer>(val => Buffer.isBuffer(val), { error: 'Must be binary data' });
const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * Lifecycle state of a plugin the host knows about
 * generated from [PluginStatus](../../../../data/contracts/plugins/plugins.types.ck#L7)
 */
export const PluginStatus = z.enum(['discovered', 'disabled', 'misconfigured', 'active', 'failed']);
export type PluginStatus = z.infer<typeof PluginStatus>;

/**
 * Where the station found a plugin: shipped inside the image, or installed by the operator into the plugins
 * directory on the data volume. Says nothing about trust; both kinds run inside the station with its privileges
 * generated from [PluginOrigin](../../../../data/contracts/plugins/plugins.types.ck#L11)
 */
export const PluginOrigin = z.enum(['bundled', 'installed']);
export type PluginOrigin = z.infer<typeof PluginOrigin>;

/**
 * generated from [ConfigFieldType](../../../../data/contracts/plugins/plugins.types.ck#L13)
 */
export const ConfigFieldType = z.enum(['string', 'text', 'url', 'secret', 'number', 'boolean', 'select', 'multiselect', 'list', 'note']);
export type ConfigFieldType = z.infer<typeof ConfigFieldType>;

/**
 * What a `number` field's value is measured in. The stored value is always in this unit; only the
 * control the operator touches changes, so a byte count stays a byte count everywhere it is read and
 * a `fraction` stays the share between 0 and 1 that the code multiplying by it wants
 * generated from [ConfigFieldUnit](../../../../data/contracts/plugins/plugins.types.ck#L18)
 */
export const ConfigFieldUnit = z.enum(['bytes', 'fraction']);
export type ConfigFieldUnit = z.infer<typeof ConfigFieldUnit>;

/**
 * The control a field asks to be drawn with, where the ordinary one for its type reads badly. Opt-in
 * per field rather than inferred, because a slider is right for a value you feel for and wrong for
 * one you have to hit exactly, and `tags` is right for a comma-separated line that is really a SET
 * and wrong for one that is prose. Nothing about the stored value changes either way
 * generated from [ConfigFieldControl](../../../../data/contracts/plugins/plugins.types.ck#L24)
 */
export const ConfigFieldControl = z.enum(['slider', 'tags']);
export type ConfigFieldControl = z.infer<typeof ConfigFieldControl>;

/**
 * One choice of a `select` config field
 * generated from [ConfigFieldOption](../../../../data/contracts/plugins/plugins.types.ck#L27)
 */
export const ConfigFieldOption = z.strictObject({
    value: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
});
export type ConfigFieldOption = z.infer<typeof ConfigFieldOption>;

/**
 * Where a field's or a column's choices come from when only the console can enumerate them: the
 * station's own tables, the platform's zone list, the enabled plugins that can do one of four jobs,
 * or the models the selected model plugin currently offers. Resolved by the console either way
 * generated from [ConfigFieldOptionSource](../../../../data/contracts/plugins/plugins.types.ck#L35)
 */
export const ConfigFieldOptionSource = z.enum([
    'station.newsCategories',
    'station.newsFeeds',
    'intl.timeZones',
    'plugins.speech',
    'plugins.llm',
    'plugins.mixer',
    'plugins.analysis',
    'llm.models',
]);
export type ConfigFieldOptionSource = z.infer<typeof ConfigFieldOptionSource>;

/**
 * A plugin handed over from the browser. The generated client types the body as `FormData`, so
 * nothing checks this shape. It says what to send
 * generated from [PluginImport](../../../../data/contracts/plugins/plugins.types.ck#L93)
 */
export const PluginImport = z.strictObject({
    file: _ZodBinary.describe('The gzip tarball npm pack writes: every entry under package/, holding package.json and the built code, at most 64 MB'),
});
export type PluginImport = z.infer<typeof PluginImport>;

/**
 * generated from [PluginLogLevel](../../../../data/contracts/plugins/plugins.types.ck#L104)
 */
export const PluginLogLevel = z.enum(['debug', 'info', 'warn', 'error']);
export type PluginLogLevel = z.infer<typeof PluginLogLevel>;

/**
 * A submitted settings form. Secret values arrive in here and are never echoed back
 * generated from [PluginConfigInput](../../../../data/contracts/plugins/plugins.types.ck#L136)
 */
export const PluginConfigInput = z.strictObject({
    config: z.record(z.string(), z.unknown()),
});
export type PluginConfigInput = z.infer<typeof PluginConfigInput>;

/**
 * What a plugin may do with a capability it asked for. Denied is the default and needs no row: a
 * capability is refused until somebody allows it, so "never answered" and "refused" are one state
 * generated from [GrantDecision](../../../../data/contracts/plugins/plugins.types.ck#L142)
 */
export const GrantDecision = z.enum(['allowed', 'denied']);
export type GrantDecision = z.infer<typeof GrantDecision>;

/**
 * Outcome of the plugin's own `testConnection()`
 * generated from [PluginTestResult](../../../../data/contracts/plugins/plugins.types.ck#L166)
 */
export const PluginTestResult = z.strictObject({
    ok: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    message: z.string().max(4000).optional(),
});
export type PluginTestResult = z.infer<typeof PluginTestResult>;

/**
 * Where the console should send the browser to obtain the operator's consent. Reported rather than
 * redirected to: the route is behind the Bearer floor, so a browser cannot follow a redirect from it
 * generated from [PluginOAuthStart](../../../../data/contracts/plugins/plugins.types.ck#L184)
 */
export const PluginOAuthStart = z.strictObject({
    url: z.url(),
});
export type PluginOAuthStart = z.infer<typeof PluginOAuthStart>;

/**
 * Outcome of an OAuth callback
 * generated from [PluginOAuthResult](../../../../data/contracts/plugins/plugins.types.ck#L189)
 */
export const PluginOAuthResult = z.strictObject({
    pluginId: z.string().min(1).max(200),
    ok: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    message: z.string().max(4000).optional(),
});
export type PluginOAuthResult = z.infer<typeof PluginOAuthResult>;

/**
 * generated from [PluginOAuthCallbackQuery](../../../../data/contracts/plugins/plugins.types.ck#L195)
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
 * generated from [PluginFieldSuggestions](../../../../data/contracts/plugins/plugins.types.ck#L174)
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
 * One column of a `list` field. Every ordinary cell is stored as a string in the row, so this describes the
 * control rather than the value; a `secret` cell is encrypted on its own and is never in the row at all
 * generated from [ConfigFieldColumn](../../../../data/contracts/plugins/plugins.types.ck#L39)
 */
export const ConfigFieldColumn = z.strictObject({
    key: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
    type: z.enum(['string', 'url', 'select', 'secret']),
    required: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
    placeholder: z.string().max(400).optional(),
    options: z.array(ConfigFieldOption).optional(),
    optionsFrom: ConfigFieldOptionSource.optional(),
    dependsOn: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
            "Key of another column in the same list. This cell applies only to a row whose cell there holds one of `dependsOnValues`. Stronger than a field's `dependsOn`, which only hides a control: a cell that does not apply is neither sent by the console nor read by the host, so a `url` column that does not apply to a row contributes no hostname to the plugin's allowlist. A target this list does not declare, or a target cell still empty, shows the cell",
        ),
    dependsOnValues: z
        .array(z.string().min(1).max(200))
        .optional()
        .describe('The values of the `dependsOn` cell this one applies to. Omitted means any non-empty value; ignored without a target'),
});
export type ConfigFieldColumn = z.infer<typeof ConfigFieldColumn>;

/**
 * generated from [PluginLogEntry](../../../../data/contracts/plugins/plugins.types.ck#L106)
 */
export const PluginLogEntry = z.strictObject({
    ts: z.string().max(40),
    level: PluginLogLevel,
    text: z.string().max(65536).describe('Must match MAX_LINE_BYTES_CEILING in apps/api/src/logging/rotating.log.store.ts. Change both together'),
});
export type PluginLogEntry = z.infer<typeof PluginLogEntry>;

/**
 * generated from [PluginLogQuery](../../../../data/contracts/plugins/plugins.types.ck#L118)
 */
export const PluginLogQuery = z.strictObject({
    limit: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(2000)).optional(),
    level: PluginLogLevel.optional(),
});
export type PluginLogQuery = z.infer<typeof PluginLogQuery>;

/**
 * generated from [PluginLogLevelInput](../../../../data/contracts/plugins/plugins.types.ck#L123)
 */
export const PluginLogLevelInput = z.strictObject({
    level: PluginLogLevel,
});
export type PluginLogLevelInput = z.infer<typeof PluginLogLevelInput>;

/**
 * One capability a plugin asked for, with the station's answer. The ask is the plugin's manifest and
 * the answer is a row, so a plugin that stops asking stops appearing here whatever was stored
 * generated from [PluginGrant](../../../../data/contracts/plugins/plugins.types.ck#L146)
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
 * generated from [PluginGrantInput](../../../../data/contracts/plugins/plugins.types.ck#L160)
 */
export const PluginGrantInput = z.strictObject({
    capability: z.string().min(1).max(100),
    decision: GrantDecision,
});
export type PluginGrantInput = z.infer<typeof PluginGrantInput>;

/**
 * Mirrors the plugin SDK's `ConfigField`: enough for a console to render the settings form with no per-plugin code
 * generated from [ConfigFieldDescriptor](../../../../data/contracts/plugins/plugins.types.ck#L52)
 */
export const ConfigFieldDescriptor = z.strictObject({
    key: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
    type: ConfigFieldType,
    required: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
    default: z
        .union([
            z.string(),
            z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number()),
            z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
        ])
        .optional(),
    unit: ConfigFieldUnit.optional().describe('`number` only, and ignored elsewhere'),
    control: ConfigFieldControl.optional().describe(
        '`slider` for a `number` with both `min` and `max`, `tags` for a `string` holding a comma-separated set',
    ),
    step: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number())
        .optional()
        .describe("How coarsely a `control` moves, in the field's own unit. Ignored without one, and defaults to 1"),
    min: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number())
        .optional()
        .describe('`number` only: the smallest value that will be accepted, inclusive'),
    max: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number())
        .optional()
        .describe('`number` only: the largest value that will be accepted, inclusive'),
    placeholder: z.string().max(400).optional(),
    help: z.string().max(2000).optional(),
    options: z.array(ConfigFieldOption).optional(),
    optionsFrom: ConfigFieldOptionSource.optional().describe(
        "Choices only the console can enumerate. Merged where a plugin's own suggestions are, and outranked by them",
    ),
    columns: z.array(ConfigFieldColumn).optional().describe('`list` only, and ignored elsewhere'),
    dependsOn: z.string().min(1).max(200).optional().describe('Key of the field this one is only relevant to'),
    rangeWith: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
            'Key of the `number` field that is the upper end of the range this one opens, declared on the lower end only. Still two settings, each validated by name; the console draws them as one control whose handles cannot cross',
        ),
});
export type ConfigFieldDescriptor = z.infer<typeof ConfigFieldDescriptor>;

/**
 * generated from [PluginLogPage](../../../../data/contracts/plugins/plugins.types.ck#L112)
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
 * generated from [PluginGrantList](../../../../data/contracts/plugins/plugins.types.ck#L156)
 */
export const PluginGrantList = z.strictObject({
    grants: z.array(PluginGrant).describe('Every capability every installed plugin is asking for, refused ones included'),
});
export type PluginGrantList = z.infer<typeof PluginGrantList>;

/**
 * A plugin as the settings list sees it. Carries no configured VALUES, only which secrets are set
 * generated from [PluginSummary](../../../../data/contracts/plugins/plugins.types.ck#L73)
 */
export const PluginSummary = z.strictObject({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    version: z.string().min(1).max(100),
    capabilities: z.array(z.string().min(1).max(100)),
    usesTrackFetcher: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            "Whether the manifest declares the `trackFetcher` permission, so its records reach air through the station's own track fetcher and that fetcher needs its own authorization. Not the same as the `stream` capability, which a plugin that mints its own stream URLs declares too. Absent means it does not",
        ),
    status: PluginStatus,
    origin: PluginOrigin,
    enabled: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    description: z.string().max(2000).optional(),
    icon: z.string().max(2000).optional(),
    configFields: z.array(ConfigFieldDescriptor),
    secretsConfigured: z
        .record(
            z.string(),
            z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
        )
        .describe(
            'Whether a value is currently stored, per `secret` field under its own key and per `secret` cell under `field/rowId/column`. Never the value itself',
        ),
    firstEnabledAt: _ZodDatetime
        .optional()
        .describe('When this plugin was first ever enabled. Absent means it never has been, so the console asks before it is'),
    lastError: z.string().max(4000).optional().describe('The last recorded failure. Absent means it is not currently unhappy'),
    nextProbeAt: _ZodDatetime.optional().describe('When the breaker will probe this plugin again on its own. Absent means no probe is pending'),
});
export type PluginSummary = z.infer<typeof PluginSummary>;

export const PluginSummaryInput = z.strictObject({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    version: z.string().min(1).max(100),
    capabilities: z.array(z.string().min(1).max(100)),
    usesTrackFetcher: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            "Whether the manifest declares the `trackFetcher` permission, so its records reach air through the station's own track fetcher and that fetcher needs its own authorization. Not the same as the `stream` capability, which a plugin that mints its own stream URLs declares too. Absent means it does not",
        ),
    status: PluginStatus,
    origin: PluginOrigin,
    enabled: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    description: z.string().max(2000).optional(),
    icon: z.string().max(2000).optional(),
    configFields: z.array(ConfigFieldDescriptor),
    secretsConfigured: z
        .record(
            z.string(),
            z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
        )
        .describe(
            'Whether a value is currently stored, per `secret` field under its own key and per `secret` cell under `field/rowId/column`. Never the value itself',
        ),
    lastError: z.string().max(4000).optional().describe('The last recorded failure. Absent means it is not currently unhappy'),
});
export type PluginSummaryInput = z.infer<typeof PluginSummaryInput>;

/**
 * What an import did
 * generated from [PluginImportResult](../../../../data/contracts/plugins/plugins.types.ck#L98)
 */
export const PluginImportResult = z.strictObject({
    pluginId: z.string().min(1).max(200).describe('The id the imported plugin claimed'),
    restartRequired: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe(
            'The same version was already loaded, so the station runs the build it had until it restarts. False for a new plugin and for a new version',
        ),
    plugins: z
        .array(PluginSummary)
        .describe('Every plugin, as the catalogue now stands. An import can take an older version away as well as add one'),
});
export type PluginImportResult = z.infer<typeof PluginImportResult>;

export const PluginImportResultInput = z.strictObject({
    pluginId: z.string().min(1).max(200).describe('The id the imported plugin claimed'),
    restartRequired: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe(
            'The same version was already loaded, so the station runs the build it had until it restarts. False for a new plugin and for a new version',
        ),
    plugins: z
        .array(PluginSummaryInput)
        .describe('Every plugin, as the catalogue now stands. An import can take an older version away as well as add one'),
});
export type PluginImportResultInput = z.infer<typeof PluginImportResultInput>;

/**
 * A summary plus the stored NON-SECRET configuration
 * generated from [PluginDetail](../../../../data/contracts/plugins/plugins.types.ck#L128)
 */
export const PluginDetail = PluginSummary.extend({
    dir: z.string().min(1).max(4096).describe("Absolute path of the plugin's directory on the station"),
    config: z.record(z.string(), z.unknown()),
    oauthConnected: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
    logLevel: PluginLogLevel,
});
export type PluginDetail = z.infer<typeof PluginDetail>;

export const PluginDetailInput = PluginSummaryInput.extend({
    dir: z.string().min(1).max(4096).describe("Absolute path of the plugin's directory on the station"),
    config: z.record(z.string(), z.unknown()),
    oauthConnected: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
    logLevel: PluginLogLevel,
});
export type PluginDetailInput = z.infer<typeof PluginDetailInput>;
