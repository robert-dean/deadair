import { z } from 'zod';

/**
 * The kinds of input a plugin can ask the operator for.
 *
 * - `string`      free text
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
export type ConfigFieldType = 'string' | 'url' | 'secret' | 'number' | 'boolean' | 'select' | 'multiselect' | 'note';

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

export const configFieldTypeSchema = z.enum(['string', 'url', 'secret', 'number', 'boolean', 'select', 'multiselect', 'note']);

export const configFieldSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: configFieldTypeSchema,
    required: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    placeholder: z.string().optional(),
    help: z.string().optional(),
    options: z.array(configFieldOptionSchema).optional(),
    dependsOn: z.string().optional(),
});
