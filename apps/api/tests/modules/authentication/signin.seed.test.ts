// The Google sign-in used to come from two environment variables. It comes from the console's
// provider list now, and a station upgraded past the change must not lose it: the seed copies the
// variables into the list once. "Once" is the property that matters, because the variables are
// still set in every unraid template, and an operator who deletes the Google row should not find it
// back after the next restart.

import { describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';

import { seedSigninProvidersFromEnv, SIGNIN_SEEDED_KEY } from '../../../src/modules/authentication/signin.seed.js';
import { SIGNIN_KEYS } from '../../../src/modules/authentication/signin.settings.js';
import { AfterCommit } from '../../../src/modules/data/after.commit.js';
import { SettingsRepository } from '../../../src/modules/settings/settings.repository.js';
import { SettingsService } from '../../../src/modules/settings/settings.service.js';
import { settingsConfig } from '../../utils/settings.config.js';

const GOOGLE = { GOOGLE_OIDC_CLIENT_ID: 'client', GOOGLE_OIDC_CLIENT_SECRET: 'secret' };

function build(values: Record<string, string>, options: { writeFails?: boolean } = {}) {
    const station = settingsConfig(values);
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const write = vi.fn(async () => {
        if (options.writeFails) throw new Error('database away');
    });
    const set = vi.fn(async () => undefined);
    const afterCommit = new AfterCommit();
    const reload = vi.fn(async () => undefined);
    afterCommit.add(reload);

    const scope = {
        get: (token: unknown) => {
            if (token === SettingsService) return { write };
            if (token === SettingsRepository) return { set };
            if (token === AfterCommit) return afterCommit;
            throw new Error(`unexpected ${String(token)}`);
        },
        disposeAsync: vi.fn(async () => undefined),
    };
    const container = {
        get: (token: unknown) => (token === AppConfig ? station.config : token === Logger ? logger : undefined),
        createScopedContainer: () => scope,
    } as unknown as Container;

    return { seed: () => seedSigninProvidersFromEnv(container), write, set, reload, logger };
}

describe('seedSigninProvidersFromEnv', () => {
    it('copies the Google variables into the provider list, with the secret written as a row secret', async () => {
        const h = build({ ...GOOGLE, GOOGLE_OIDC_ISSUER: 'http://localhost:3080/default' });

        await expect(h.seed()).resolves.toBe('seeded');

        const submitted = (h.write.mock.calls[0] as unknown as [Record<string, string>])[0];
        expect(JSON.parse(submitted[SIGNIN_KEYS.providers] ?? '')).toEqual([
            { name: 'google', label: 'Google', issuer: 'http://localhost:3080/default', clientId: 'client', clientSecret: 'secret' },
        ]);
        expect(h.set).toHaveBeenCalledWith(SIGNIN_SEEDED_KEY, expect.any(String));
        expect(h.reload).toHaveBeenCalledOnce();
        expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining('no longer read'));
    });

    it('points at Google itself when no issuer is named', async () => {
        const h = build(GOOGLE);
        await h.seed();
        const submitted = (h.write.mock.calls[0] as unknown as [Record<string, string>])[0];
        expect(submitted[SIGNIN_KEYS.providers]).toContain('https://accounts.google.com');
    });

    it('does nothing unless both variables are set', async () => {
        const h = build({ GOOGLE_OIDC_CLIENT_ID: 'client' });
        await expect(h.seed()).resolves.toBe('skipped');
        expect(h.write).not.toHaveBeenCalled();
    });

    it('never writes over a provider list the operator has stored, even an empty one', async () => {
        const h = build({ ...GOOGLE, [SIGNIN_KEYS.providers]: '[]' });
        await expect(h.seed()).resolves.toBe('skipped');
        expect(h.write).not.toHaveBeenCalled();
    });

    it('does not copy a second time after the list was deleted outright', async () => {
        const h = build({ ...GOOGLE, [SIGNIN_SEEDED_KEY]: '2026-09-23T00:00:00.000Z' });
        await expect(h.seed()).resolves.toBe('skipped');
        expect(h.write).not.toHaveBeenCalled();
    });

    it('logs a failed copy and lets the station boot', async () => {
        const h = build(GOOGLE, { writeFails: true });
        await expect(h.seed()).resolves.toBe('skipped');
        expect(h.logger.error).toHaveBeenCalledOnce();
    });
});
