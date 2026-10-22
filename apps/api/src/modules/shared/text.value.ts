/**
 * A value that should be text, as trimmed text, or `undefined` when it is not usable.
 *
 * Not a string, empty, and whitespace-only are all "not set". That is the reading every caller here
 * wants for a field a model filled in, a jsonb column read back, or a tool argument: a model filling
 * every field writes `""` for the ones it has nothing for, and a blank that passed through would be
 * stored, sent upstream or spoken as though it were a value. Thirteen modules wrote this one line as
 * a local `text` or `readText`.
 */
export const nonEmptyText = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};
