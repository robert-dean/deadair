// The registry asks its source on every lookup, so anything the source says it says on every
// sign-in. A row the operator left half-filled should be named in the log once, not once a login.

import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import type { Logger } from '@maroonedsoftware/logger';
import { ROW_ID_KEY } from '@deadair/plugin-sdk';

import { oidcRedirectUri } from '../../../src/modules/authentication/signin.settings.js';
import { SettingsOidcProviderSource } from '../../../src/modules/authentication/settings.oidc.provider.source.js';
import { SIGNIN_KEYS } from '../../../src/modules/authentication/signin.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';

const encryption = new EncryptionProvider(randomBytes(32));
const container = {
    createScopedContainer: () => ({ get: () => encryption, disposeAsync: async () => undefined }),
} as unknown as Container;

describe('SettingsOidcProviderSource', () => {
    it('names an unusable row in the log once however many lookups read it', async () => {
        const warn = vi.fn();
        const rows = [{ [ROW_ID_KEY]: 'r1', name: 'authelia', label: '', issuer: 'https://auth.example.com', clientId: 'deadair' }];
        const config = settingsConfig({ APP_BASE_URL: 'https://radio.example', [SIGNIN_KEYS.providers]: JSON.stringify(rows) }).config;
        const source = new SettingsOidcProviderSource(config, container, { warn } as unknown as Logger, oidcRedirectUri);

        expect(await source.list()).toEqual([]);
        await source.list();

        expect(warn).toHaveBeenCalledOnce();
    });

    it('answers no providers on a station with no public address, rather than throwing', async () => {
        const source = new SettingsOidcProviderSource(settingsConfig().config, container, { warn: vi.fn() } as unknown as Logger, oidcRedirectUri);
        await expect(source.list()).resolves.toEqual([]);
    });
});
