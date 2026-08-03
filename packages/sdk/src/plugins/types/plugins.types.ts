/**
 * Lifecycle state of a plugin the host knows about
 * generated from [PluginStatus](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L7)
 */
export type PluginStatus = 'discovered' | 'disabled' | 'misconfigured' | 'active' | 'failed';

/**
 * One choice of a `select` config field
 * generated from [ConfigFieldType](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L9)
 */
export type ConfigFieldType = 'string' | 'url' | 'secret' | 'number' | 'boolean' | 'select' | 'note';

/**
 * generated from [ConfigFieldOption](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L12)
 */
export interface ConfigFieldOption {
    value: string;
    label: string;
}

/**
 * A submitted settings form. Secret values arrive in here and are never echoed back
 * generated from [PluginConfigInput](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L52)
 */
export interface PluginConfigInput {
    config: Record<string, unknown>;
}

/**
 * Outcome of the plugin's own `testConnection()`
 * generated from [PluginTestResult](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L57)
 */
export interface PluginTestResult {
    ok: boolean;
    message?: string;
}

/**
 * Where the console should send the browser to obtain the operator's consent. Reported rather than
 * redirected to: the route is behind the Bearer floor, so a browser cannot follow a redirect from it
 * generated from [PluginOAuthStart](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L64)
 */
export interface PluginOAuthStart {
    url: string;
}

/**
 * Outcome of an OAuth callback
 * generated from [PluginOAuthResult](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L69)
 */
export interface PluginOAuthResult {
    pluginId: string;
    ok: boolean;
    message?: string;
}

/**
 * generated from [PluginListQuery](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L75)
 */
export interface PluginListQuery {
    /** Narrows the list to one plugin kind, e.g. `music-provider` */
    kind?: string;
}

/**
 * generated from [PluginOAuthCallbackQuery](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L79)
 */
export interface PluginOAuthCallbackQuery {
    code?: string;
    state?: string;
    error?: string;
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
 * A plugin as the settings list sees it. Carries no configured VALUES, only which secrets are set
 * generated from [PluginSummary](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L31)
 */
export interface PluginSummary {
    id: string;
    name: string;
    version: string;
    kind: string;
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
 * A summary plus the stored NON-SECRET configuration and the last recorded failure
 * generated from [PluginDetail](file://./../../../../../apps/api/data/contracts/plugins/plugins.types.ck#L46)
 */
export interface PluginDetail extends PluginSummary {
    config: Record<string, unknown>;
    lastError?: string;
}
