import { Decimal } from 'decimal.js';
import { DateTime } from 'luxon';

Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 });
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * Lifecycle state of a plugin the host knows about
 * generated from [PluginStatus](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L7)
 */
export type PluginStatus = 'discovered' | 'disabled' | 'misconfigured' | 'active' | 'failed';

/**
 * generated from [ConfigFieldType](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L9)
 */
export type ConfigFieldType = 'string' | 'text' | 'url' | 'secret' | 'number' | 'boolean' | 'select' | 'multiselect' | 'list' | 'note';

/**
 * What a `number` field's value is measured in. The stored value is always in this unit; only the
 * control the operator touches changes, so a byte count stays a byte count everywhere it is read and
 * a `fraction` stays the share between 0 and 1 that the code multiplying by it wants
 * generated from [ConfigFieldUnit](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L14)
 */
export type ConfigFieldUnit = 'bytes' | 'fraction';

/**
 * The control a field asks to be drawn with, where the ordinary one for its type reads badly. Opt-in
 * per field rather than inferred, because a slider is right for a value you feel for and wrong for
 * one you have to hit exactly, and `tags` is right for a comma-separated line that is really a SET
 * and wrong for one that is prose. Nothing about the stored value changes either way
 * generated from [ConfigFieldControl](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L20)
 */
export type ConfigFieldControl = 'slider' | 'tags';

/**
 * One choice of a `select` config field
 * generated from [ConfigFieldOption](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L23)
 */
export interface ConfigFieldOption {
    value: string;
    label: string;
}

/**
 * Where a field's or a column's choices come from when only the console can enumerate them: the
 * station's own tables, the platform's zone list, the enabled plugins that can do one of four jobs,
 * or the models the selected model plugin currently offers. Resolved by the console either way
 * generated from [ConfigFieldOptionSource](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L31)
 */
export type ConfigFieldOptionSource =
    | 'station.newsCategories'
    | 'station.newsFeeds'
    | 'intl.timeZones'
    | 'plugins.speech'
    | 'plugins.llm'
    | 'plugins.mixer'
    | 'plugins.analysis'
    | 'llm.models';

/**
 * generated from [PluginLogLevel](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L83)
 */
export type PluginLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * A submitted settings form. Secret values arrive in here and are never echoed back
 * generated from [PluginConfigInput](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L115)
 */
export interface PluginConfigInput {
    config: Record<string, unknown>;
}

/**
 * What a plugin may do with a capability it asked for. Denied is the default and needs no row: a
 * capability is refused until somebody allows it, so "never answered" and "refused" are one state
 * generated from [GrantDecision](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L121)
 */
export type GrantDecision = 'allowed' | 'denied';

/**
 * Outcome of the plugin's own `testConnection()`
 * generated from [PluginTestResult](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L145)
 */
export interface PluginTestResult {
    ok: boolean;
    message?: string;
}

/**
 * Where the console should send the browser to obtain the operator's consent. Reported rather than
 * redirected to: the route is behind the Bearer floor, so a browser cannot follow a redirect from it
 * generated from [PluginOAuthStart](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L163)
 */
export interface PluginOAuthStart {
    url: string;
}

/**
 * Outcome of an OAuth callback
 * generated from [PluginOAuthResult](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L168)
 */
export interface PluginOAuthResult {
    pluginId: string;
    ok: boolean;
    message?: string;
}

/**
 * generated from [PluginOAuthCallbackQuery](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L174)
 */
export interface PluginOAuthCallbackQuery {
    code?: string;
    state?: string;
    error?: string;
    ubi?: string;
    /**
     * What a desktop-style flow returns instead of `code`: the provider mints a token before the
     * consent screen and hands the same one back, which the plugin exchanges for a session. Last.fm's
     * auth works this way. Listed here because the route parses this query strictly, so an
     * undeclared parameter is a 400 before any plugin code runs
     */
    token?: string;
}

/**
 * Live choices for a plugin's config fields, keyed by field key, out of the plugin's own
 * `suggestConfigOptions()`. What `ConfigFieldDescriptor.options` cannot be: fixed when the manifest
 * was written, where these are whatever the operator's own server currently says
 * generated from [PluginFieldSuggestions](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L153)
 */
export interface PluginFieldSuggestions {
    /** Keys the plugin had nothing to say about are simply absent, rather than present and empty */
    fields: Record<string, ConfigFieldOption[]>;
    /**
     * False when the plugin does not implement suggestions at all, so a console can tell "nothing to
     * suggest" from "asked and got nothing", and draw a refresh control only where one would do something
     */
    supported: boolean;
}

/**
 * One column of a `list` field. Every ordinary cell is stored as a string in the row, so this describes the
 * control rather than the value; a `secret` cell is encrypted on its own and is never in the row at all
 * generated from [ConfigFieldColumn](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L35)
 */
export interface ConfigFieldColumn {
    key: string;
    label: string;
    type: 'string' | 'url' | 'select' | 'secret';
    required?: boolean;
    placeholder?: string;
    options?: ConfigFieldOption[];
    optionsFrom?: ConfigFieldOptionSource;
    /** Key of another column in the same list. This cell applies only to a row whose cell there holds one of `dependsOnValues`. Stronger than a field's `dependsOn`, which only hides a control: a cell that does not apply is neither sent by the console nor read by the host, so a `url` column that does not apply to a row contributes no hostname to the plugin's allowlist. A target this list does not declare, or a target cell still empty, shows the cell */
    dependsOn?: string;
    /** The values of the `dependsOn` cell this one applies to. Omitted means any non-empty value; ignored without a target */
    dependsOnValues?: string[];
}

/**
 * generated from [PluginLogEntry](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L85)
 */
export interface PluginLogEntry {
    ts: string;
    level: PluginLogLevel;
    /** Must match MAX_LINE_BYTES_CEILING in apps/api/src/logging/rotating.log.store.ts. Change both together */
    text: string;
}

/**
 * generated from [PluginLogQuery](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L97)
 */
export interface PluginLogQuery {
    limit?: number;
    level?: PluginLogLevel;
}

/**
 * generated from [PluginLogLevelInput](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L102)
 */
export interface PluginLogLevelInput {
    level: PluginLogLevel;
}

/**
 * One capability a plugin asked for, with the station's answer. The ask is the plugin's manifest and
 * the answer is a row, so a plugin that stops asking stops appearing here whatever was stored
 * generated from [PluginGrant](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L125)
 */
export interface PluginGrant {
    pluginId: string;
    pluginName: string;
    /** The host's own id for it, e.g. `network.open` */
    capability: string;
    /** What the host calls the capability */
    label: string;
    /** What allowing it opens up, in the station's words */
    describes: string;
    /** Why this plugin says it needs it, in the plugin's words */
    reason: string;
    decision: GrantDecision;
}

/**
 * generated from [PluginGrantInput](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L139)
 */
export interface PluginGrantInput {
    capability: string;
    decision: GrantDecision;
}

/**
 * Mirrors the plugin SDK's `ConfigField`: enough for a console to render the settings form with no per-plugin code
 * generated from [ConfigFieldDescriptor](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L48)
 */
export interface ConfigFieldDescriptor {
    key: string;
    label: string;
    type: ConfigFieldType;
    required?: boolean;
    default?: string | number | boolean;
    /** `number` only, and ignored elsewhere */
    unit?: ConfigFieldUnit;
    /** `slider` for a `number` with both `min` and `max`, `tags` for a `string` holding a comma-separated set */
    control?: ConfigFieldControl;
    /** How coarsely a `control` moves, in the field's own unit. Ignored without one, and defaults to 1 */
    step?: number;
    /** `number` only: the smallest value that will be accepted, inclusive */
    min?: number;
    /** `number` only: the largest value that will be accepted, inclusive */
    max?: number;
    placeholder?: string;
    help?: string;
    options?: ConfigFieldOption[];
    /** Choices only the console can enumerate. Merged where a plugin's own suggestions are, and outranked by them */
    optionsFrom?: ConfigFieldOptionSource;
    /** `list` only, and ignored elsewhere */
    columns?: ConfigFieldColumn[];
    /** Key of the field this one is only relevant to */
    dependsOn?: string;
    /** Key of the `number` field that is the upper end of the range this one opens, declared on the lower end only. Still two settings, each validated by name; the console draws them as one control whose handles cannot cross */
    rangeWith?: string;
}

/**
 * generated from [PluginLogPage](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L91)
 */
export interface PluginLogPage {
    pluginId: string;
    level: PluginLogLevel;
    /** Newest first, as the activity feed and the script history send. The download is the file as written, oldest first */
    entries: PluginLogEntry[];
}

/**
 * generated from [PluginGrantList](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L135)
 */
export interface PluginGrantList {
    /** Every capability every installed plugin is asking for, refused ones included */
    grants: PluginGrant[];
}

/**
 * A plugin as the settings list sees it. Carries no configured VALUES, only which secrets are set
 * generated from [PluginSummary](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L69)
 */
export interface PluginSummary {
    id: string;
    name: string;
    version: string;
    capabilities: string[];
    status: PluginStatus;
    enabled: boolean;
    description?: string;
    icon?: string;
    configFields: ConfigFieldDescriptor[];
    /** Whether a value is currently stored, per `secret` field under its own key and per `secret` cell under `field/rowId/column`. Never the value itself */
    secretsConfigured: Record<string, boolean>;
    /** When this plugin was first ever enabled. Absent means it never has been, so the console asks before it is */
    firstEnabledAt?: DateTime;
}

export interface PluginSummaryInput {
    id: string;
    name: string;
    version: string;
    capabilities: string[];
    status: PluginStatus;
    enabled: boolean;
    description?: string;
    icon?: string;
    configFields: ConfigFieldDescriptor[];
    /** Whether a value is currently stored, per `secret` field under its own key and per `secret` cell under `field/rowId/column`. Never the value itself */
    secretsConfigured: Record<string, boolean>;
}

/** Rehydrates every wire-encoded scalar in a PluginSummary into its runtime type. Mutates and returns `raw`. */
export function revivePluginSummary(raw: PluginSummary): PluginSummary {
    const __o0 = raw as unknown as Record<string, unknown>;
    if (__o0['firstEnabledAt'] != null) {
        __o0['firstEnabledAt'] = __dt(__o0['firstEnabledAt'], 'PluginSummary.firstEnabledAt');
    }
    return raw;
}

/**
 * A summary plus the stored NON-SECRET configuration and the last recorded failure
 * generated from [PluginDetail](../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L107)
 */
export interface PluginDetail extends PluginSummary {
    config: Record<string, unknown>;
    lastError?: string;
    oauthConnected?: boolean;
    logLevel: PluginLogLevel;
}

export interface PluginDetailInput extends PluginSummaryInput {
    config: Record<string, unknown>;
    lastError?: string;
    oauthConnected?: boolean;
    logLevel: PluginLogLevel;
}

/** Rehydrates every wire-encoded scalar in a PluginDetail into its runtime type. Mutates and returns `raw`. */
export function revivePluginDetail(raw: PluginDetail): PluginDetail {
    revivePluginSummary(raw as never);
    return raw;
}
