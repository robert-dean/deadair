import { z } from 'zod';

/**
 * The kinds of input a plugin can ask the operator for.
 *
 * - `string`  free text
 * - `url`     free text validated/normalised as a URL
 * - `secret`  write-only: the host encrypts it, the settings UI never reads it
 *             back, and only `host.secrets.get()` sees the plaintext
 * - `number`  numeric input
 * - `boolean` toggle
 * - `select`  one of `options`
 * - `note`    not an input at all: static help text rendered in the form
 */
export type ConfigFieldType = 'string' | 'url' | 'secret' | 'number' | 'boolean' | 'select' | 'note';

/** One choice in a `select` field. */
export interface ConfigFieldOption {
    value: string;
    label: string;
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

    /** Choices. Only meaningful when `type` is `'select'`. */
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

export const configFieldTypeSchema = z.enum(['string', 'url', 'secret', 'number', 'boolean', 'select', 'note']);

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
