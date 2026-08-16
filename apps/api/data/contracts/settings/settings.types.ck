options {
    keys: {
        area: settings
    }
}

contract SettingGroup: enum(station, rotation, playout, render, llm, analysis, plugins) # Which section of the settings page a setting belongs in

# A station setting as the console needs to render it. `ConfigFieldDescriptor` is the plugins area's,
# and shared deliberately: a plugin's settings form and the station's are the same problem, and the
# console renders both with one component
contract StationSettingDescriptor: ConfigFieldDescriptor & {
    group: SettingGroup
}

# Every station setting, with what it is currently worth
contract StationSettings: {
    descriptors: array(StationSettingDescriptor)
    values: record(string, unknown) # Every NON-secret setting, with defaults filled in for whatever is not stored
    configured: record(string, boolean) # One entry per `secret` setting: whether a value is currently stored. Never the value itself
}

# A submitted settings form. Partial: a key that is present is written, a key that is absent is left
# alone, so a console may send one field. A secret submitted blank clears it
contract StationSettingsInput: {
    values: record(string, unknown)
}
