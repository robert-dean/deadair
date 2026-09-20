import type { ConfigFieldDescriptor } from '../../plugins/types/plugins.types.js';

/**
 * Which part of the console owns a setting. Every one of these but `schedule`, `personas` and `providers` is a section of the settings page; `schedule` is edited on the schedule page, beside the timetable it describes, `personas` on the characters page, beside the names it stands behind, and `providers` on the Providers section, which draws each capability beside the plugins that answer it rather than as a form of text fields.
 * generated from [SettingGroup](../../../../../apps/api/data/contracts/settings/settings.types.ck#L7)
 */
export type SettingGroup =
    'station' | 'stream' | 'housekeeping' | 'mail' | 'rotation' | 'playout' | 'render' | 'llm' | 'analysis' | 'schedule' | 'personas' | 'providers';

/**
 * A submitted settings form. Partial: a key that is present is written, a key that is absent is left
 * alone, so a console may send one field. A secret submitted blank clears it
 * generated from [StationSettingsInput](../../../../../apps/api/data/contracts/settings/settings.types.ck#L44)
 */
export interface StationSettingsInput {
    values: Record<string, unknown>;
}

/**
 * A station setting as the console needs to render it. `ConfigFieldDescriptor` is the plugins area's,
 * and shared deliberately: a plugin's settings form and the station's are the same problem, and the
 * console renders both with one component
 * generated from [StationSettingDescriptor](../../../../../apps/api/data/contracts/settings/settings.types.ck#L30)
 */
export interface StationSettingDescriptor extends ConfigFieldDescriptor {
    group: SettingGroup;
}

/**
 * Every station setting, with what it is currently worth
 * generated from [StationSettings](../../../../../apps/api/data/contracts/settings/settings.types.ck#L35)
 */
export interface StationSettings {
    descriptors: StationSettingDescriptor[];
    /** Every NON-secret setting, with defaults filled in for whatever is not stored */
    values: Record<string, unknown>;
    /** One entry per `secret` setting: whether a value is currently stored. Never the value itself */
    configured: Record<string, boolean>;
    /** One entry per setting whose EMPTY value is worked out rather than simply absent: the public URL from the address the station was deployed with, the advertised hostname from the public URL, the station's zone from this machine's. What the station WOULD use with the box left empty, which is not the same as what is in force — the stored value is deliberately skipped, so a filled-in field still reports what clearing it would fall back to. A key is absent where its derivation lands on nothing. Values only: where each one comes from is in the field's own help text, which has said so since before this map existed */
    derived: Record<string, string>;
}
