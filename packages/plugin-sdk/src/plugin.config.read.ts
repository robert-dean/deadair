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
