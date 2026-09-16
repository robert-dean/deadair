import { describe, expect, it } from 'vitest';
import { AppConfig } from '@maroonedsoftware/appconfig';

import { resolveOwnerConnection, resolveRuntimeConnection } from '../../../src/modules/data/database.connection.js';

const OWNER = {
    DATABASE_HOST: 'db',
    DATABASE_PORT: '5432',
    DATABASE_USER: 'postgres',
    DATABASE_PASSWORD: 'owner-secret',
    DATABASE_NAME: 'deadair',
};

/**
 * Every value a real `AppConfig` layer holds is a STRING, so every fixture here is written as one
 * and the signature refuses anything else. `DATABASE_PORT` was `5432` the number for as long as
 * this file existed, which proved nothing about the resolver: it passed whether the port came back
 * as a number or as the `'5432'` the resolver actually handed `pg`.
 */
const configOf = (values: Record<string, string>): AppConfig => new AppConfig(values);

describe('resolveOwnerConnection', () => {
    it('reads the owner role straight off the config', () => {
        expect(resolveOwnerConnection(configOf(OWNER))).toEqual({
            host: 'db',
            port: 5432,
            user: 'postgres',
            password: 'owner-secret',
            database: 'deadair',
        });
    });

    it('answers a real number for a port that was configured as a string', () => {
        // `config.get('DATABASE_PORT', 55432)` typed as `number` and returned `'5432'`, and only
        // `pg` coercing it on the way into the socket kept that from showing.
        expect(resolveOwnerConnection(configOf({ ...OWNER, DATABASE_PORT: '5433' })).port).toBe(5433);
    });

    it('falls back to a local port when none is configured', () => {
        expect(resolveOwnerConnection(configOf({})).port).toBe(55432);
    });

    it('falls back for a port that is configured as nothing at all', () => {
        // An empty value is a key nobody set, which is what the fallback is for. It is worth its own
        // case because `Number('')` is `0` and finite, so a reader written the tolerant way would
        // answer port zero here rather than the default.
        expect(resolveOwnerConnection(configOf({ ...OWNER, DATABASE_PORT: '' })).port).toBe(55432);
    });

    it('refuses a port that is set and unreadable rather than guessing', () => {
        // The failure this replaced: `NaN` is falsy, so `pg` reads it as a port nobody set and
        // connects on 5432 instead. The error then names authentication, or nothing at all if
        // something is listening there, rather than the two characters that caused it.
        expect(() => resolveOwnerConnection(configOf({ ...OWNER, DATABASE_PORT: '54 32' }))).toThrow(/DATABASE_PORT/);
    });
});

describe('resolveRuntimeConnection', () => {
    it('swaps in the app role, keeping the owner host and database', () => {
        const config = configOf({ ...OWNER, DATABASE_APP_USER: 'app_user', DATABASE_APP_PASSWORD: 'app-secret' });

        expect(resolveRuntimeConnection(config)).toEqual({
            host: 'db',
            port: 5432,
            user: 'app_user',
            password: 'app-secret',
            database: 'deadair',
        });
    });

    it('falls back to the owner when no app role is configured', () => {
        // The development case: one set of credentials, running as the owner. It has to keep
        // working, so an unset DATABASE_APP_USER is not an error.
        expect(resolveRuntimeConnection(configOf(OWNER))).toEqual(resolveOwnerConnection(configOf(OWNER)));
    });

    it('does not fall back to the owner password when the app role has none', () => {
        // An app user configured with no password is a misconfiguration, and connecting as
        // `app_user` with the OWNER's password would be a confusing way to fail: the error would
        // name authentication rather than the empty setting behind it.
        const config = configOf({ ...OWNER, DATABASE_APP_USER: 'app_user' });

        expect(resolveRuntimeConnection(config).password).toBe('');
    });
});
