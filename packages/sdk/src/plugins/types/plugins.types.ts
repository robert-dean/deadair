/**
 * Lifecycle state of a plugin the host knows about
 * generated from [PluginStatus](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L7)
 */
export type PluginStatus = 'discovered' | 'disabled' | 'misconfigured' | 'active' | 'failed';

/**
 * generated from [ConfigFieldType](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L9)
 */
export type ConfigFieldType = 'string' | 'url' | 'secret' | 'number' | 'boolean' | 'select' | 'multiselect' | 'note';

/**
 * One choice of a `select` config field
 * generated from [ConfigFieldOption](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L12)
 */
export interface ConfigFieldOption {
    value: string;
    label: string;
}

/**
 * generated from [PluginLogLevel](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L44)
 */
export type PluginLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * A submitted settings form. Secret values arrive in here and are never echoed back
 * generated from [PluginConfigInput](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L76)
 */
export interface PluginConfigInput {
    config: Record<string, unknown>;
}

/**
 * Outcome of the plugin's own `testConnection()`
 * generated from [PluginTestResult](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L81)
 */
export interface PluginTestResult {
    ok: boolean;
    message?: string;
}

/**
 * Where the console should send the browser to obtain the operator's consent. Reported rather than
 * redirected to: the route is behind the Bearer floor, so a browser cannot follow a redirect from it
 * generated from [PluginOAuthStart](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L99)
 */
export interface PluginOAuthStart {
    url: string;
}

/**
 * Outcome of an OAuth callback
 * generated from [PluginOAuthResult](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L104)
 */
export interface PluginOAuthResult {
    pluginId: string;
    ok: boolean;
    message?: string;
}

/**
 * generated from [PluginOAuthCallbackQuery](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L110)
 */
export interface PluginOAuthCallbackQuery {
    code?: string;
    state?: string;
    error?: string;
    ubi?: string;
}

/**
 * Mirrors the plugin SDK's `ConfigField`: enough for a console to render the settings form with no per-plugin code
 * generated from [ConfigFieldDescriptor](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L18)
 */
export interface ConfigFieldDescriptor {
    key: string;
    label: string;
    type: ConfigFieldType;
    required?: boolean;
    default?: string | number | boolean;
    placeholder?: string;
    help?: string;
    options?: ConfigFieldOption[];
    /** Key of the field this one is only relevant to */
    dependsOn?: string;
}

/**
 * Live choices for a plugin's config fields, keyed by field key, out of the plugin's own
 * `suggestConfigOptions()`. What `ConfigFieldDescriptor.options` cannot be: fixed when the manifest
 * was written, where these are whatever the operator's own server currently says
 * generated from [PluginFieldSuggestions](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L89)
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
 * generated from [PluginLogEntry](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L46)
 */
export interface PluginLogEntry {
    ts: string;
    level: PluginLogLevel;
    /** Must match MAX_LINE_BYTES_CEILING in apps/api/src/logging/rotating.log.store.ts. Change both together */
    text: string;
}

/**
 * generated from [PluginLogQuery](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L58)
 */
export interface PluginLogQuery {
    limit?: number;
    level?: PluginLogLevel;
}

/**
 * generated from [PluginLogLevelInput](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L63)
 */
export interface PluginLogLevelInput {
    level: PluginLogLevel;
}

/**
 * A plugin as the settings list sees it. Carries no configured VALUES, only which secrets are set
 * generated from [PluginSummary](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L31)
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
    /** One entry per `secret` field: whether a value is currently stored. Never the value itself */
    secretsConfigured: Record<string, boolean>;
}

/**
 * generated from [PluginLogPage](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L52)
 */
export interface PluginLogPage {
    pluginId: string;
    level: PluginLogLevel;
    entries: PluginLogEntry[];
}

/**
 * A summary plus the stored NON-SECRET configuration and the last recorded failure
 * generated from [PluginDetail](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L68)
 */
export interface PluginDetail extends PluginSummary {
    config: Record<string, unknown>;
    lastError?: string;
    oauthConnected?: boolean;
    logLevel: PluginLogLevel;
}
