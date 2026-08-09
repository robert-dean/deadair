import { describe, expect, it } from 'vitest';
import { AppConfig } from '@maroonedsoftware/appconfig';

import { resolveOwnerConnection, resolveRuntimeConnection } from '../../../src/modules/data/database.connection.js';

const OWNER = {
    DATABASE_HOST: 'db',
    DATABASE_PORT: 5432,
    DATABASE_USER: 'postgres',
    DATABASE_PASSWORD: 'owner-secret',
    DATABASE_NAME: 'deadair',
};

const configOf = (values: Record<string, unknown>): AppConfig => new AppConfig(values);

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

    it('falls back to a local port when none is configured', () => {
        expect(resolveOwnerConnection(configOf({})).port).toBe(55432);
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
        // The development case: one set of credentials, and RLS not enforced because the owner
        // bypasses it. It has to keep working, so an unset DATABASE_APP_USER is not an error.
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
