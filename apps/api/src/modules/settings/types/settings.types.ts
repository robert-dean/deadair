import { z } from 'zod';
import { ConfigFieldDescriptor } from '../../plugins/types/plugins.types.js';

/**
 * Which part of the console owns a setting. Every one of these but `schedule` and `personas` is a section of the settings page; `schedule` is edited on the schedule page, beside the timetable it describes, and `personas` on the characters page, beside the names it stands behind.
 * generated from [SettingGroup](../../../../data/contracts/settings/settings.types.ck#L7)
 */
export const SettingGroup = z.enum([
    'station',
    'stream',
    'housekeeping',
    'mail',
    'rotation',
    'playout',
    'render',
    'llm',
    'analysis',
    'schedule',
    'personas',
]);
export type SettingGroup = z.infer<typeof SettingGroup>;

/**
 * A submitted settings form. Partial: a key that is present is written, a key that is absent is left
 * alone, so a console may send one field. A secret submitted blank clears it
 * generated from [StationSettingsInput](../../../../data/contracts/settings/settings.types.ck#L43)
 */
export const StationSettingsInput = z.strictObject({
    values: z.record(z.string(), z.unknown()),
});
export type StationSettingsInput = z.infer<typeof StationSettingsInput>;

/**
 * A station setting as the console needs to render it. `ConfigFieldDescriptor` is the plugins area's,
 * and shared deliberately: a plugin's settings form and the station's are the same problem, and the
 * console renders both with one component
 * generated from [StationSettingDescriptor](../../../../data/contracts/settings/settings.types.ck#L29)
 */
export const StationSettingDescriptor = ConfigFieldDescriptor.extend({
    group: SettingGroup,
});
export type StationSettingDescriptor = z.infer<typeof StationSettingDescriptor>;

/**
 * Every station setting, with what it is currently worth
 * generated from [StationSettings](../../../../data/contracts/settings/settings.types.ck#L34)
 */
export const StationSettings = z.strictObject({
    descriptors: z.array(StationSettingDescriptor),
    values: z.record(z.string(), z.unknown()).describe('Every NON-secret setting, with defaults filled in for whatever is not stored'),
    configured: z
        .record(
            z.string(),
            z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
        )
        .describe('One entry per `secret` setting: whether a value is currently stored. Never the value itself'),
    derived: z
        .record(z.string(), z.string())
        .describe(
            "One entry per setting whose EMPTY value is worked out rather than simply absent: the public URL from the address the station was deployed with, the advertised hostname from the public URL, the station's zone from this machine's. What the station WOULD use with the box left empty, which is not the same as what is in force — the stored value is deliberately skipped, so a filled-in field still reports what clearing it would fall back to. A key is absent where its derivation lands on nothing. Values only: where each one comes from is in the field's own help text, which has said so since before this map existed",
        ),
});
export type StationSettings = z.infer<typeof StationSettings>;
