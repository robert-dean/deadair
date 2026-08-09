import type { SettingDescriptor } from './settings.registry.js';

/**
 * What a setting is worth, once it has been read back out of a text column.
 *
 * `deadair.settings.value` is `text`, so every setting is a string on the way in
 * and out. The descriptor is what says which of these it was meant to be, and
 * these two functions are the only place that conversion happens.
 */
export type SettingValue = string | number | boolean;

/** Why a submitted value was refused, in a sentence for the operator who typed it. */
export interface SettingRejection {
    key: string;
    message: string;
}

/**
 * A stored string as the type its descriptor says it is.
 *
 * `undefined` in means the key is not stored, which is answered with the
 * descriptor's default rather than with `undefined`: a settings form has to
 * render something, and what it should render is what the station is actually
 * using. A `secret` never comes back at all — see {@link readSetting}'s caller.
 */
export function parseSetting(descriptor: SettingDescriptor, stored: string | undefined): SettingValue {
    if (stored === undefined) return descriptor.default ?? (descriptor.type === 'boolean' ? false : '');

    switch (descriptor.type) {
        case 'boolean':
            // Only the exact string `false` is false. Anything else stored in a boolean's row —
            // including the empty string — reads as true, which matches how `listenerHooks` has
            // always been read and keeps a hand-edited row from silently turning a feature off.
            return stored !== 'false';
        case 'number': {
            const parsed = Number(stored);
            // A number column holding something that is not one falls back rather than answering
            // NaN. NaN would reach a console as `null` and a comparison as false, and neither says
            // what went wrong.
            return Number.isFinite(parsed) ? parsed : (descriptor.default ?? 0);
        }
        default:
            return stored;
    }
}

/**
 * A submitted value as the string that goes in the column, or why it cannot.
 *
 * Validation and serialization together on purpose: they are the same question
 * asked twice otherwise, and splitting them is how a value gets validated in one
 * shape and stored in another.
 */
export function serializeSetting(descriptor: SettingDescriptor, submitted: unknown): { value: string } | { rejected: SettingRejection } {
    const reject = (message: string): { rejected: SettingRejection } => ({ rejected: { key: descriptor.key, message } });

    switch (descriptor.type) {
        case 'boolean': {
            if (typeof submitted === 'boolean') return { value: String(submitted) };
            if (submitted === 'true' || submitted === 'false') return { value: submitted };
            return reject(`"${descriptor.label}" is a switch, so it takes true or false`);
        }

        case 'number': {
            const parsed = typeof submitted === 'number' ? submitted : Number(String(submitted).trim());
            if (!Number.isFinite(parsed)) return reject(`"${descriptor.label}" takes a number`);
            return { value: String(parsed) };
        }

        case 'select': {
            const value = String(submitted ?? '');
            const allowed = descriptor.options ?? [];
            if (!allowed.some(option => option.value === value)) {
                return reject(`"${value}" is not one of the choices for "${descriptor.label}"`);
            }
            return { value };
        }

        case 'url': {
            const value = String(submitted ?? '').trim();
            // Empty is allowed and meaningful: several of these read "not set" as "derive it", so
            // clearing one is how an operator goes back to that rather than a thing to refuse.
            if (value === '') return requiredOr(descriptor, reject, { value });
            try {
                new URL(value);
            } catch {
                return reject(`"${descriptor.label}" needs a full URL, including the scheme`);
            }
            return { value };
        }

        default: {
            const value = String(submitted ?? '').trim();
            return requiredOr(descriptor, reject, { value });
        }
    }
}

/** A required field refuses an empty value; an optional one is allowed to be cleared. */
function requiredOr(
    descriptor: SettingDescriptor,
    reject: (message: string) => { rejected: SettingRejection },
    ok: { value: string },
): { value: string } | { rejected: SettingRejection } {
    if (descriptor.required === true && ok.value === '') return reject(`"${descriptor.label}" cannot be empty`);
    return ok;
}
