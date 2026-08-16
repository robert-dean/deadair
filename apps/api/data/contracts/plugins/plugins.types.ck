options {
    keys: {
        area: plugins
    }
}

contract PluginStatus: enum(discovered, disabled, misconfigured, active, failed) # Lifecycle state of a plugin the host knows about

contract ConfigFieldType: enum(string, text, url, secret, number, boolean, select, multiselect, note)

# What a `number` field's value is measured in. The stored value is always in this unit; only the
# control the operator touches changes, so a byte count stays a byte count everywhere it is read
contract ConfigFieldUnit: enum(bytes)

# One choice of a `select` config field
contract ConfigFieldOption: {
    value: string(min=1, max=200)
    label: string(min=1, max=200)
}

# Mirrors the plugin SDK's `ConfigField`: enough for a console to render the settings form with no per-plugin code
contract ConfigFieldDescriptor: {
    key: string(min=1, max=200)
    label: string(min=1, max=200)
    type: ConfigFieldType
    required?: boolean
    default?: string | number | boolean
    unit?: ConfigFieldUnit # `number` only, and ignored elsewhere
    placeholder?: string(max=400)
    help?: string(max=2000)
    options?: array(ConfigFieldOption)
    dependsOn?: string(min=1, max=200) # Key of the field this one is only relevant to
}

# A plugin as the settings list sees it. Carries no configured VALUES, only which secrets are set
contract PluginSummary: {
    id: string(min=1, max=200)
    name: string(min=1, max=200)
    version: string(min=1, max=100)
    capabilities: array(string(min=1, max=100))
    status: PluginStatus
    enabled: boolean
    description?: string(max=2000)
    icon?: string(max=2000)
    configFields: array(ConfigFieldDescriptor)
    secretsConfigured: record(string, boolean) # One entry per `secret` field: whether a value is currently stored. Never the value itself
}

contract PluginLogLevel: enum(debug, info, warn, error)

contract PluginLogEntry: {
    ts: string(max=40)
    level: PluginLogLevel
    text: string(max=65536) # Must match MAX_LINE_BYTES_CEILING in apps/api/src/logging/rotating.log.store.ts. Change both together
}

contract PluginLogPage: {
    pluginId: string(min=1, max=200)
    level: PluginLogLevel
    entries: array(PluginLogEntry)
}

contract PluginLogQuery: {
    limit?: int(min=1, max=2000)
    level?: PluginLogLevel
}

contract PluginLogLevelInput: {
    level: PluginLogLevel
}

# A summary plus the stored NON-SECRET configuration and the last recorded failure
contract PluginDetail: PluginSummary & {
    config: record(string, unknown)
    lastError?: string(max=4000)
    oauthConnected?: boolean
    logLevel: PluginLogLevel
}

# A submitted settings form. Secret values arrive in here and are never echoed back
contract PluginConfigInput: {
    config: record(string, unknown)
}

# Outcome of the plugin's own `testConnection()`
contract GrantDecision: enum(allowed, denied, undecided) # What the operator has said. `undecided` is the absence of an answer, and it refuses exactly as `denied` does

# One capability a plugin asked for, with the station's answer. The ask is the plugin's manifest and
# the answer is a row, so a plugin that stops asking stops appearing here whatever was stored
contract PluginGrant: {
    pluginId: string(min=1, max=200)
    pluginName: string(min=1, max=200)
    capability: string(min=1, max=100) # The host's own id for it, e.g. `network.open`
    label: string(min=1, max=200) # What the host calls the capability
    describes: string(min=1, max=2000) # What allowing it opens up, in the station's words
    reason: string(min=1, max=2000) # Why this plugin says it needs it, in the plugin's words
    decision: GrantDecision
}

contract PluginGrantList: {
    grants: array(PluginGrant) # Every capability every installed plugin is asking for, undecided ones included
}

contract PluginGrantInput: {
    capability: string(min=1, max=100)
    decision: GrantDecision
}

contract PluginTestResult: {
    ok: boolean
    message?: string(max=4000)
}

# Live choices for a plugin's config fields, keyed by field key, out of the plugin's own
# `suggestConfigOptions()`. What `ConfigFieldDescriptor.options` cannot be: fixed when the manifest
# was written, where these are whatever the operator's own server currently says
contract PluginFieldSuggestions: {
    # Keys the plugin had nothing to say about are simply absent, rather than present and empty
    fields: record(string, array(ConfigFieldOption))
    # False when the plugin does not implement suggestions at all, so a console can tell "nothing to
    # suggest" from "asked and got nothing", and draw a refresh control only where one would do something
    supported: boolean
}

# Where the console should send the browser to obtain the operator's consent. Reported rather than
# redirected to: the route is behind the Bearer floor, so a browser cannot follow a redirect from it
contract PluginOAuthStart: {
    url: url
}

# Outcome of an OAuth callback
contract PluginOAuthResult: {
    pluginId: string(min=1, max=200)
    ok: boolean
    message?: string(max=4000)
}

contract mode(strip) PluginOAuthCallbackQuery: {
    code?: string(max=2048)
    state?: string(max=400)
    error?: string(max=400)
    ubi?: string(max=400)
    # What a desktop-style flow returns instead of `code`: the provider mints a token before the
    # consent screen and hands the same one back, which the plugin exchanges for a session. Last.fm's
    # auth works this way. Listed here because the route parses this query strictly, so an
    # undeclared parameter is a 400 before any plugin code runs
    token?: string(max=2048)
}
