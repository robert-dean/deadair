import type { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * Reading a numeric setting, which is not the same as reading it as a number.
 *
 * ## Why this exists
 *
 * The numeric half of `setting.flags.ts`, which that file named as the missing sibling when it
 * consolidated the boolean one — the three coercions it found included "a `Number.parseInt` for the
 * numeric cousins", and only the boolean half got written.
 *
 * The cause is the same and worth restating rather than cross-referencing, because it is invisible
 * at the call site: **every layer of `AppConfig` holds strings.** dotenv yields a
 * `Record<string, string>` and `AppConfigSourcePostgres` snapshots each row as raw text, so a value
 * that is SET arrives as `'2097152'` however numeric it looks. What hides it is the typing:
 * `get(key, 2 * 1024 * 1024)` widens to `number` from the default, so TypeScript reports a `number`
 * and the runtime hands over a string. Everything downstream then does string arithmetic — `+` is
 * concatenation, `>` compares lexically — and none of it throws.
 *
 * ## Two readers, because the right failure differs
 *
 * Conflating them is what went wrong. A tolerant fallback is right for an operator-facing setting
 * out of `deadair.settings`, where a nonsense value should leave the feature on its default rather
 * than take the station down. It is wrong for boot configuration: `LOG_MAX_BYTES=2MB` silently
 * produced a log store that threw on every append, caught by the never-throw wrapper, and the
 * symptom was an empty logs directory on a server that looked fine — the exact outcome the comment
 * at the call site said must not happen, next to a reference to a validator that was never written.
 *
 * So {@link requiredNumber} refuses and {@link numberOr} falls back, and which one a caller wants is
 * a question about whether a wrong answer is recoverable.
 */

/**
 * A number the process cannot sensibly start without.
 *
 * Throws naming the variable and the value it could not read, which is the whole point: the failure
 * arrives at boot pointing at the typo rather than hours later as a subsystem that quietly does
 * nothing. An UNSET key is not an error — that is what the fallback is for — and only a value that
 * is present and unreadable is.
 *
 * @param config - The boot snapshot. Read through it rather than `process.env`, which is scrubbed.
 * @param key - The dotenv name, quoted back in the message.
 * @param fallback - What an unset key means.
 */
export function requiredNumber(config: AppConfig, key: string, fallback: number): number {
    // Read as `unknown`, and the cast is the point rather than a nuisance: `get`'s overload widens
    // the return from the DEFAULT's type, so it declares `number` while handing back the raw text.
    // Trusting that signature is the whole bug, so this refuses to be told what the value is.
    const raw: unknown = config.get(key, fallback);
    if (raw === undefined || raw === null || raw === '') return fallback;

    // Already a number only when the default was taken, since nothing coerces on the way out.
    if (typeof raw === 'number') return finiteOrThrow(raw, key, String(raw));

    const parsed = Number(String(raw).trim());
    return finiteOrThrow(parsed, key, String(raw));
}

/**
 * A number whose absence or nonsense is survivable.
 *
 * The tolerant twin, and the behaviour `DataModule` already had as a local closure. Anything
 * unreadable takes the fallback silently, on `settingIsOn`'s rule: a value nobody can parse is a
 * setting nobody set, and the declared default is the considered answer for that.
 */
export function numberOr(config: AppConfig, key: string, fallback: number): number {
    const parsed = Number(config.get(key, fallback));
    return Number.isFinite(parsed) ? parsed : fallback;
}

/** The same question asked of a value already in hand. */
export function numberFrom(raw: unknown, fallback: number): number {
    if (raw === undefined || raw === null || raw === '') return fallback;

    const parsed = Number(typeof raw === 'string' ? raw.trim() : raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function finiteOrThrow(parsed: number, key: string, raw: string): number {
    if (Number.isFinite(parsed)) return parsed;

    throw new Error(`${key} must be a number, but it is set to "${raw}". Fix it or unset it to take the default.`);
}
