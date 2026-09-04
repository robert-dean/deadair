options {
    keys: {
        area: plugins
    }
}

contract PluginStatus: enum(discovered, disabled, misconfigured, active, failed) # Lifecycle state of a plugin the host knows about

contract ConfigFieldType: enum(string, text, url, secret, number, boolean, select, multiselect, list, note)

# What a `number` field's value is measured in. The stored value is always in this unit; only the
# control the operator touches changes, so a byte count stays a byte count everywhere it is read and
# a `fraction` stays the share between 0 and 1 that the code multiplying by it wants
contract ConfigFieldUnit: enum(bytes, fraction)

# The control a field asks to be drawn with, where the ordinary one for its type reads badly. Opt-in
# per field rather than inferred, because a slider is right for a value you feel for and wrong for
# one you have to hit exactly, and `tags` is right for a comma-separated line that is really a SET
# and wrong for one that is prose. Nothing about the stored value changes either way
contract ConfigFieldControl: enum(slider, tags)

# One choice of a `select` config field
contract ConfigFieldOption: {
    value: string(min=1, max=200)
    label: string(min=1, max=200)
}

# Where a field's or a column's choices come from when only the console can enumerate them: the
# station's own tables, the platform's zone list, the enabled plugins that can do one of four jobs,
# or the models the selected model plugin currently offers. Resolved by the console either way
contract ConfigFieldOptionSource: enum(station.newsCategories, station.newsFeeds, intl.timeZones, plugins.speech, plugins.llm, plugins.mixer, plugins.analysis, llm.models)

# One column of a `list` field. Every cell is stored as a string, so this describes the control rather than the value
contract ConfigFieldColumn: {
    key: string(min=1, max=200)
    label: string(min=1, max=200)
    type: enum(string, url, select)
    required?: boolean
    placeholder?: string(max=400)
    options?: array(ConfigFieldOption)
    optionsFrom?: ConfigFieldOptionSource
}

# Mirrors the plugin SDK's `ConfigField`: enough for a console to render the settings form with no per-plugin code
contract ConfigFieldDescriptor: {
    key: string(min=1, max=200)
    label: string(min=1, max=200)
    type: ConfigFieldType
    required?: boolean
    default?: string | number | boolean
    unit?: ConfigFieldUnit # `number` only, and ignored elsewhere
    control?: ConfigFieldControl # `slider` for a `number` with both `min` and `max`, `tags` for a `string` holding a comma-separated set
    step?: number # How coarsely a `control` moves, in the field's own unit. Ignored without one, and defaults to 1
    min?: number # `number` only: the smallest value that will be accepted, inclusive
    max?: number # `number` only: the largest value that will be accepted, inclusive
    placeholder?: string(max=400)
    help?: string(max=2000)
    options?: array(ConfigFieldOption)
    optionsFrom?: ConfigFieldOptionSource # Choices only the console can enumerate. Merged where a plugin's own suggestions are, and outranked by them
    columns?: array(ConfigFieldColumn) # `list` only, and ignored elsewhere
    dependsOn?: string(min=1, max=200) # Key of the field this one is only relevant to
    rangeWith?: string(min=1, max=200) # Key of the `number` field that is the upper end of the range this one opens, declared on the lower end only. Still two settings, each validated by name; the console draws them as one control whose handles cannot cross
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
    firstEnabledAt?: readonly datetime # When this plugin was first ever enabled. Absent means it never has been, so the console asks before it is
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
    entries: array(PluginLogEntry) # Newest first, as the activity feed and the script history send. The download is the file as written, oldest first
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

# What a plugin may do with a capability it asked for. Denied is the default and needs no row: a
# capability is refused until somebody allows it, so "never answered" and "refused" are one state
contract GrantDecision: enum(allowed, denied)

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
    grants: array(PluginGrant) # Every capability every installed plugin is asking for, refused ones included
}

contract PluginGrantInput: {
    capability: string(min=1, max=100)
    decision: GrantDecision
}

# Outcome of the plugin's own `testConnection()`
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
