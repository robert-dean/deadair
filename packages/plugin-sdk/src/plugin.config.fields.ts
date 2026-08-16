import { z } from 'zod';

/**
 * The kinds of input a plugin can ask the operator for.
 *
 * - `string`      free text, one line
 * - `text`        free text over several lines, for anything a person writes
 *                 rather than pastes: a prompt, a persona, a list of phrasings.
 *                 Stored exactly like a `string`, so nothing downstream has to
 *                 know it exists; the difference is the box the operator types
 *                 into, and a one-line box for a paragraph is the reason a
 *                 setting like that ends up being edited by hand in psql
 * - `url`         free text validated/normalised as a URL
 * - `secret`      write-only: the host encrypts it, the settings UI never reads
 *                 it back, and only `host.secrets.get()` sees the plaintext
 * - `number`      numeric input
 * - `boolean`     toggle
 * - `select`      one of `options`
 * - `multiselect` any number of `options`, stored as a JSON array of the chosen
 *                 values. Read it back with {@link parseMultiSelect}
 * - `note`        not an input at all: static help text rendered in the form
 */
export type ConfigFieldType = 'string' | 'text' | 'url' | 'secret' | 'number' | 'boolean' | 'select' | 'multiselect' | 'note';

/**
 * What a `number` field's value is measured in, so the form can offer a control a person can use.
 *
 * The VALUE is always stored in the unit named here — `bytes` means the row holds bytes — and the
 * console converts on the way in and out. That is the whole point: a byte count is the right thing
 * for code to compare against and a terrible thing to type, and the alternative to declaring it is
 * either storing a friendlier unit (and doing the multiplication at every reader) or special-casing
 * a particular setting key inside the form, which is the kind of thing nobody finds later.
 *
 * One member today. It is an enum rather than a boolean because the next one is obvious (a
 * duration in milliseconds has exactly the same problem) and because a closed set is what the
 * contract mirroring this can express.
 */
export type ConfigFieldUnit = 'bytes';

/** One choice in a `select`, a `multiselect`, or a suggestion list. */
export interface ConfigFieldOption {
    value: string;
    label: string;
}

/**
 * The chosen values of a `multiselect`, out of the string it is stored as.
 *
 * Stored as a JSON array because plugin config is a string map, and read back
 * through here so every plugin agrees on the encoding. Tolerant on purpose: a
 * value hand-edited into something unreadable answers empty rather than failing
 * a load, which for a field like "which models can use tools" is the difference
 * between a degraded station and one that will not start.
 */
export function parseMultiSelect(raw: unknown): string[] {
    if (typeof raw !== 'string' || raw.trim().length === 0) return [];

    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map(value => value.trim());
    } catch {
        return [];
    }
}

/**
 * A declarative description of one row in a plugin's settings form. The host
 * renders these; plugins never ship UI.
 */
export interface ConfigField {
    /** Key this value is stored under, and the key `host.config`/`host.secrets` reads it back by. */
    key: string;

    /** Human label shown next to the input. */
    label: string;

    type: ConfigFieldType;

    /** Whether the form refuses to save without a value. Defaults to false. */
    required?: boolean;

    /** Prefilled value. Never provide a default for a `secret`. */
    default?: string | number | boolean;

    /**
     * What a `number`'s value is measured in. Ignored on every other type.
     *
     * See {@link ConfigFieldUnit}: the stored value stays in this unit and only the control the
     * operator touches changes.
     */
    unit?: ConfigFieldUnit;

    /** Ghost text inside the input. */
    placeholder?: string;

    /** Longer explanation rendered under the input. */
    help?: string;

    /**
     * Choices, for a `select` or a `multiselect`.
     *
     * Fixed when the manifest is written, so this is for a closed set the plugin
     * decides. For anything the operator's own server decides, implement
     * `suggestConfigOptions()` instead: what it returns for this key replaces
     * these, and it can also turn a `string` into free text with suggestions.
     */
    options?: ConfigFieldOption[];

    /**
     * Key of another field in the same form. This field is only shown when
     * that field has a truthy value.
     */
    dependsOn?: string;
}

export const configFieldOptionSchema = z.object({
    value: z.string(),
    label: z.string(),
});

export const configFieldTypeSchema = z.enum(['string', 'text', 'url', 'secret', 'number', 'boolean', 'select', 'multiselect', 'note']);

export const configFieldUnitSchema = z.enum(['bytes']);

export const configFieldSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: configFieldTypeSchema,
    required: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    unit: configFieldUnitSchema.optional(),
    placeholder: z.string().optional(),
    help: z.string().optional(),
    options: z.array(configFieldOptionSchema).optional(),
    dependsOn: z.string().optional(),
});
