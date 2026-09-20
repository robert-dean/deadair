options {
    keys: {
        area: settings
    }
}

contract SettingGroup: enum(
    station,
    stream,
    housekeeping,
    mail,
    rotation,
    playout,
    render,
    llm,
    analysis,
    schedule,
    personas,
    providers
) # Which part of the console owns a setting. Every one of these but `schedule`, `personas` and `providers` is a section of the settings page; `schedule` is edited on the schedule page, beside the timetable it describes, `personas` on the characters page, beside the names it stands behind, and `providers` on the Providers section, which draws each capability beside the plugins that answer it rather than as a form of text fields.
  # `station`, `stream` and `housekeeping` were one group until the page under it grew to thirty-one
  # fields under a single save: station identity, stream formats and HLS tuning, activity retention and
  # the sync threshold, and four passwords, each meant for a different kind of visit. The passwords
  # were a fourth group, `secrets`, until the station stopped declaring them: it seeds them itself
  # and nothing outside it holds one.

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
    derived: record(string, string) # One entry per setting whose EMPTY value is worked out rather than simply absent: the public URL from the address the station was deployed with, the advertised hostname from the public URL, the station's zone from this machine's. What the station WOULD use with the box left empty, which is not the same as what is in force — the stored value is deliberately skipped, so a filled-in field still reports what clearing it would fall back to. A key is absent where its derivation lands on nothing. Values only: where each one comes from is in the field's own help text, which has said so since before this map existed
}

# A submitted settings form. Partial: a key that is present is written, a key that is absent is left
# alone, so a console may send one field. A secret submitted blank clears it
contract StationSettingsInput: {
    values: record(string, unknown)
}
