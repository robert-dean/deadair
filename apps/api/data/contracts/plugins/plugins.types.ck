options {
    keys: {
        area: plugins
    }
}

contract PluginStatus: enum(discovered, disabled, misconfigured, active, failed) # Lifecycle state of a plugin the host knows about

contract ConfigFieldType: enum(string, url, secret, number, boolean, select, note)

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
    kind: string(min=1, max=100)
    capabilities: array(string(min=1, max=100))
    status: PluginStatus
    enabled: boolean
    description?: string(max=2000)
    icon?: string(max=2000)
    configFields: array(ConfigFieldDescriptor)
    secretsConfigured: record(string, boolean) # One entry per `secret` field: whether a value is currently stored. Never the value itself
}

# A summary plus the stored NON-SECRET configuration and the last recorded failure
contract PluginDetail: PluginSummary & {
    config: record(string, unknown)
    lastError?: string(max=4000)
    oauthConnected?: boolean
}

# A submitted settings form. Secret values arrive in here and are never echoed back
contract PluginConfigInput: {
    config: record(string, unknown)
}

# Outcome of the plugin's own `testConnection()`
contract PluginTestResult: {
    ok: boolean
    message?: string(max=4000)
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

contract PluginListQuery: {
    kind?: string(min=1, max=100) # Narrows the list to one plugin kind, e.g. `music-provider`
}

contract mode(strip) PluginOAuthCallbackQuery: {
    code?: string(max=2048)
    state?: string(max=400)
    error?: string(max=400)
    ubi?: string(max=400)
}
