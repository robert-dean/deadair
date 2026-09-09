import { AppConfig } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { numberOr } from '#modules/shared/setting.numbers.js';

/**
 * The `deadair.settings` keys backing outbound mail.
 *
 * In the database rather than the environment, on the rule the README states for the station as a
 * whole: `.env` holds what has to exist before a database does, and everything else is a row an
 * operator edits from the settings page and the station picks up live. Nothing here is needed at
 * boot — the first send is a sign-in, which is a request — so none of it belongs in `.env`.
 *
 * There is deliberately no `mail.enabled`. The switch is `mail.host`: a station with somewhere to
 * send mail sends it, and one without is told so in as many words when something tries. A separate
 * flag would be a second thing to get wrong, and the failure it enables — configured but switched
 * off — looks identical from the console to the one it was meant to prevent.
 */
export const MAIL_KEYS = {
    host: 'mail.host',
    port: 'mail.port',
    /**
     * TLS from the first byte (SMTPS, usually 465) rather than STARTTLS on a plaintext connection
     * (usually 587). Off by default because 587 is, and because a `secure` connection to a server
     * expecting STARTTLS hangs rather than failing: the client waits for a TLS handshake the server
     * will not start until it is asked in plaintext.
     */
    secure: 'mail.secure',
    user: 'mail.user',
    password: 'mail.password',
    from: 'mail.from',
} as const;

export const MAIL_DEFAULTS = {
    port: 587,
    secure: false,
} as const;

/** The bounds `resolveMailSettings` clamps a stored port to, shared with the registry's `min`/`max`. */
export const MIN_MAIL_PORT = 1;
export const MAX_MAIL_PORT = 65535;

/** Everything the transport needs to open a connection and address an envelope. */
export interface MailSettings {
    host: string;
    port: number;
    secure: boolean;
    /** Absent when the server takes no credentials, which a local relay usually does not. */
    user?: string;
    password?: string;
    /** The envelope sender, as an address. The display name is added per send. */
    from: string;
}

/**
 * Read the mail settings, decrypting the password and filling in {@link MAIL_DEFAULTS}.
 *
 * Answers `undefined` — not a half-built object — when the station has nowhere to send mail, which
 * is a host or a from-address that is unset or blank. Those two are the whole test: a server needs
 * an address to connect to and an envelope needs a sender, and every other field has an answer
 * without the operator. Callers branch on the `undefined` rather than on a flag, so "is mail
 * configured" has exactly one definition.
 *
 * Built through `has` rather than `get(key, '')`, on the rule `resolveStreamSettings` states: an
 * ABSENT key falls through to its default and a key stored as the empty string stays empty, and
 * reading both with a `''` default collapses the two.
 */
export function resolveMailSettings(config: AppConfig, encryption: EncryptionProvider): MailSettings | undefined {
    const values = new Map<string, string>();
    for (const key of Object.values(MAIL_KEYS)) {
        if (config.has(key)) values.set(key, config.get(key, ''));
    }

    const host = values.get(MAIL_KEYS.host)?.trim() ?? '';
    const from = values.get(MAIL_KEYS.from)?.trim() ?? '';
    if (host.length === 0 || from.length === 0) return undefined;

    // Tolerate a plaintext value, as the stream secrets do: an operator seeding a password by hand
    // with psql is a reasonable thing to do, and refusing the whole config over it would take
    // sign-in down rather than the one setting.
    const decrypt = (raw: string | undefined): string | undefined => {
        if (!raw) return undefined;
        try {
            return encryption.decrypt(raw);
        } catch {
            return raw;
        }
    };

    const user = values.get(MAIL_KEYS.user)?.trim();
    const password = decrypt(values.get(MAIL_KEYS.password));

    return {
        host,
        // Clamped rather than refused, on the resolver rule: this is a row already stored, and a
        // setting that will not load stops the sign-in behind it. The console refuses an
        // out-of-range figure at the point somebody types one.
        port: clamp(numberOr(config, MAIL_KEYS.port, MAIL_DEFAULTS.port), MIN_MAIL_PORT, MAX_MAIL_PORT),
        secure: settingIsOn(config, MAIL_KEYS.secure, MAIL_DEFAULTS.secure),
        ...(user ? { user } : {}),
        ...(password ? { password } : {}),
        from,
    };
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, Math.round(value)));
