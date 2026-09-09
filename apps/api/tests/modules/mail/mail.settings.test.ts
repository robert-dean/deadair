// The resolver, read the way the rest of the station has to read a setting: every layer of
// `AppConfig` holds STRINGS, so `mail.secure` arrives as `'false'` — which is truthy — and
// `mail.port` as `'587'`, which TypeScript reports as a number because `get`'s overload widens from
// the DEFAULT. Both are the failure `apps/api/CLAUDE.md` says was live in six places at once, so
// every case here hands over the string a database column would.

import { describe, expect, it } from 'vitest';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';

import { MAIL_DEFAULTS, MAIL_KEYS, resolveMailSettings } from '../../../src/modules/mail/mail.settings.js';

/** A config over a plain map, answering `has`/`get` the way the Postgres layer does: raw text. */
const configOf = (rows: Record<string, string>): AppConfig =>
    ({
        has: (key: string) => key in rows,
        get: (key: string, fallback: unknown) => (key in rows ? rows[key] : fallback),
    }) as unknown as AppConfig;

/** Decrypts by stripping a marker, and throws on anything that never went through it. */
const encryptionOf = (): EncryptionProvider =>
    ({
        decrypt: (value: string) => {
            if (!value.startsWith('enc:')) throw new Error('not ciphertext');
            return value.slice(4);
        },
        encrypt: (value: string) => `enc:${value}`,
    }) as unknown as EncryptionProvider;

const configured = { [MAIL_KEYS.host]: 'smtp.example.com', [MAIL_KEYS.from]: 'radio@example.com' };

describe('resolving the mail settings', () => {
    it('answers nothing at all when no server is set, rather than a half-built one', () => {
        expect(resolveMailSettings(configOf({}), encryptionOf())).toBeUndefined();
    });

    it('treats a blank host as unset, which is what clearing the field through the console leaves', () => {
        const settings = resolveMailSettings(configOf({ ...configured, [MAIL_KEYS.host]: '   ' }), encryptionOf());

        expect(settings).toBeUndefined();
    });

    it('needs a from address as much as a server, since most providers refuse an envelope without one', () => {
        const settings = resolveMailSettings(configOf({ [MAIL_KEYS.host]: 'smtp.example.com' }), encryptionOf());

        expect(settings).toBeUndefined();
    });

    it('fills in the defaults for what the operator did not answer', () => {
        const settings = resolveMailSettings(configOf(configured), encryptionOf());

        expect(settings).toEqual({
            host: 'smtp.example.com',
            port: MAIL_DEFAULTS.port,
            secure: false,
            from: 'radio@example.com',
        });
    });

    it('reads the port as the string a column holds', () => {
        const settings = resolveMailSettings(configOf({ ...configured, [MAIL_KEYS.port]: '465' }), encryptionOf());

        expect(settings?.port).toBe(465);
    });

    it('clamps a stored port rather than refusing it, so one bad row does not stop a sign-in', () => {
        expect(resolveMailSettings(configOf({ ...configured, [MAIL_KEYS.port]: '99999' }), encryptionOf())?.port).toBe(65535);
        expect(resolveMailSettings(configOf({ ...configured, [MAIL_KEYS.port]: '0' }), encryptionOf())?.port).toBe(1);
    });

    it('falls back to the default port when the stored value is not a number', () => {
        const settings = resolveMailSettings(configOf({ ...configured, [MAIL_KEYS.port]: 'smtp' }), encryptionOf());

        expect(settings?.port).toBe(MAIL_DEFAULTS.port);
    });

    // The whole reason `settingIsOn` exists. `'false'` is a non-empty string and therefore truthy,
    // so a switch read directly off the config could be turned on and never back off.
    it('reads the string "false" as off', () => {
        const settings = resolveMailSettings(configOf({ ...configured, [MAIL_KEYS.secure]: 'false' }), encryptionOf());

        expect(settings?.secure).toBe(false);
    });

    it('reads the strings that mean on', () => {
        for (const raw of ['true', '1', 'yes', 'on']) {
            expect(resolveMailSettings(configOf({ ...configured, [MAIL_KEYS.secure]: raw }), encryptionOf())?.secure).toBe(true);
        }
    });

    it('takes the declared default for a value that means neither', () => {
        const settings = resolveMailSettings(configOf({ ...configured, [MAIL_KEYS.secure]: 'perhaps' }), encryptionOf());

        expect(settings?.secure).toBe(MAIL_DEFAULTS.secure);
    });

    it('decrypts the stored password', () => {
        const settings = resolveMailSettings(
            configOf({ ...configured, [MAIL_KEYS.user]: 'radio', [MAIL_KEYS.password]: 'enc:hunter2' }),
            encryptionOf(),
        );

        expect(settings).toMatchObject({ user: 'radio', password: 'hunter2' });
    });

    // An operator seeding a row by hand with psql is a reasonable thing to do, and refusing the
    // whole config over it would take sign-in down rather than the one setting.
    it('takes a plaintext password as it stands rather than failing the whole config', () => {
        const settings = resolveMailSettings(configOf({ ...configured, [MAIL_KEYS.password]: 'typed-by-hand' }), encryptionOf());

        expect(settings?.password).toBe('typed-by-hand');
    });

    // A relay on the same machine usually takes none, and `undefined` rather than `''` is what
    // stops the transport building an empty `auth` block the server then rejects.
    it('leaves the credentials off entirely when none are stored', () => {
        const settings = resolveMailSettings(configOf(configured), encryptionOf());

        expect(settings && 'user' in settings).toBe(false);
        expect(settings && 'password' in settings).toBe(false);
    });
});
