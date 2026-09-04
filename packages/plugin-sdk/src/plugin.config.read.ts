import { ROW_ID_KEY, rowSecretKey } from './plugin.config.fields.js';
import type { PluginHost } from './plugin.host.js';

/**
 * Reading an operator's typed-in config field.
 *
 * `host.config.get()` answers `Record<string, unknown>`, because the values came
 * out of a database column an operator edits through a text box. Every plugin
 * therefore narrows each field itself, and every plugin was narrowing it the
 * same two ways: "a string, and blank counts as unset", and "a base URL with no
 * trailing slash".
 *
 * Blank counting as unset is the important half. A cleared text box stores `''`
 * rather than removing the row, so a plugin comparing against `undefined` alone
 * sees an empty string, treats it as a real value, and sends it upstream.
 */

/**
 * A config field as a trimmed string, or `undefined` when it is not set.
 *
 * Whitespace-only is unset for the same reason blank is: an operator who
 * selected a value and deleted it has said "none", and a space is not a model
 * name.
 */
export function configString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A base URL with no trailing slash, so a path can be appended with one.
 *
 * Answers `''` rather than `undefined` for a field that is not set, which is
 * deliberate and is what every caller already expected: a plugin holds its base
 * URL as a plain `string` and reports "not configured" by testing whether it is
 * empty, in a sentence of its own naming the thing it cannot reach ("No
 * analyzer URL set."). Making this optional would push a `?? ''` to every use
 * and change nothing else.
 */
export function configBaseUrl(value: unknown): string {
    return (configString(value) ?? '').replace(/\/+$/, '');
}

/**
 * The credential one ROW of a `list` field holds, or `undefined` when the operator has not set it.
 *
 * The whole of what a plugin has to know about secret cells. A `secret` column is never in the row
 * that {@link parseRows} hands back — that is what makes it a secret rather than a JSON string with
 * a password in it — so this is how the value is reached, and the key it is stored under is nobody's
 * business but this function's.
 *
 * Answers `undefined` for a row the host has never saved, which is the honest answer: a row with no
 * {@link ROW_ID_KEY} has never been stored, so there is nothing under it.
 *
 * ```ts
 * for (const row of parseRows(config.providers)) {
 *     const apiKey = await readRowSecret(this.host, 'providers', row, 'apiKey');
 * }
 * ```
 */
export async function readRowSecret(host: PluginHost, fieldKey: string, row: Record<string, string>, columnKey: string): Promise<string | undefined> {
    const rowId = row[ROW_ID_KEY];
    if (rowId === undefined || rowId.length === 0) return undefined;

    return await host.secrets.get(rowSecretKey(fieldKey, rowId, columnKey));
}
