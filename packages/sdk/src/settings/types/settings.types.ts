import type { ConfigFieldDescriptor } from '../../plugins/types/plugins.types.js';

/**
 * Which section of the settings page a setting belongs in
 * generated from [SettingGroup](file://./../../../../../apps/api/data/contracts/settings/settings.types.ck#L7)
 */
export type SettingGroup = 'station' | 'rotation' | 'playout' | 'render' | 'llm' | 'analysis';

/**
 * A submitted settings form. Partial: a key that is present is written, a key that is absent is left
 * alone, so a console may send one field. A secret submitted blank clears it
 * generated from [StationSettingsInput](file://./../../../../../apps/api/data/contracts/settings/settings.types.ck#L25)
 */
export interface StationSettingsInput {
    values: Record<string, unknown>;
}

/**
 * A station setting as the console needs to render it. `ConfigFieldDescriptor` is the plugins area's,
 * and shared deliberately: a plugin's settings form and the station's are the same problem, and the
 * console renders both with one component
 * generated from [StationSettingDescriptor](file://./../../../../../apps/api/data/contracts/settings/settings.types.ck#L12)
 */
export interface StationSettingDescriptor extends ConfigFieldDescriptor {
    group: SettingGroup;
}

/**
 * Every station setting, with what it is currently worth
 * generated from [StationSettings](file://./../../../../../apps/api/data/contracts/settings/settings.types.ck#L17)
 */
export interface StationSettings {
    descriptors: StationSettingDescriptor[];
    /** Every NON-secret setting, with defaults filled in for whatever is not stored */
    values: Record<string, unknown>;
    /** One entry per `secret` setting: whether a value is currently stored. Never the value itself */
    configured: Record<string, boolean>;
}
