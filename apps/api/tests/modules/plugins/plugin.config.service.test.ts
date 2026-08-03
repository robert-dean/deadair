import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import type { ConfigField } from '@deadair/plugin-sdk';

import { PluginConfigService } from '../../../src/modules/plugins/plugin.config.service.js';
import type { PluginConfigRecord, PluginConfigRepository, PluginConfigUpsert } from '../../../src/modules/plugins/plugin.config.repository.js';
import { PLUGIN_OAUTH_SECRET_KEY } from '../../../src/modules/plugins/plugin.oauth.secret.js';

/** In-memory stand-in for {@link PluginConfigRepository}: same merge semantics, no Postgres. */
class FakeConfigRepository {
    private readonly rows = new Map<string, PluginConfigRecord>();

    async get(pluginId: string): Promise<PluginConfigRecord | undefined> {
        return this.rows.get(pluginId);
    }

    async upsert(row: PluginConfigUpsert): Promise<PluginConfigRecord> {
        const existing = this.rows.get(row.pluginId);
        const now = DateTime.utc();
        const merged: PluginConfigRecord = {
            pluginId: row.pluginId,
            enabled: row.enabled ?? existing?.enabled ?? false,
            config: row.config ?? existing?.config ?? {},
            secrets: row.secrets ?? existing?.secrets ?? {},
            status: row.status === null ? undefined : (row.status ?? existing?.status),
            lastError: row.lastError === null ? undefined : (row.lastError ?? existing?.lastError),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        this.rows.set(row.pluginId, merged);
        return merged;
    }

    async setEnabled(pluginId: string, enabled: boolean): Promise<PluginConfigRecord> {
        return this.upsert({ pluginId, enabled });
    }

    async setStatus(pluginId: string, status: string, lastError?: string): Promise<PluginConfigRecord> {
        return this.upsert({ pluginId, status, lastError: lastError ?? null });
    }
}

function service(): { service: PluginConfigService; repo: FakeConfigRepository } {
    const repo = new FakeConfigRepository();
    const encryptionProvider = new EncryptionProvider(randomBytes(32));
    return { service: new PluginConfigService(repo as unknown as PluginConfigRepository, encryptionProvider), repo };
}

const fields: ConfigField[] = [
    { key: 'apiUrl', label: 'API URL', type: 'string' },
    { key: 'apiKey', label: 'API Key', type: 'secret' },
];

describe('PluginConfigService.saveConfig', () => {
    it('stores plain values as-is and secret values encrypted, decrypting back via getSecrets', async () => {
        const { service: svc, repo } = service();

        const result = await svc.saveConfig('plugin.a', fields, { apiUrl: 'https://api.example.com', apiKey: 'super-secret' });

        expect(result.config).toEqual({ apiUrl: 'https://api.example.com' });
        expect(result.configured).toEqual({ apiKey: true });

        const stored = await repo.get('plugin.a');
        expect(stored?.secrets.apiKey).toBeDefined();
        expect(stored?.secrets.apiKey).not.toBe('super-secret');

        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({ apiKey: 'super-secret' });
    });

    it('preserves the prior ciphertext for a secret omitted from a second save', async () => {
        const { service: svc, repo } = service();

        await svc.saveConfig('plugin.a', fields, { apiUrl: 'https://api.example.com', apiKey: 'super-secret' });
        const firstCiphertext = (await repo.get('plugin.a'))?.secrets.apiKey;

        await svc.saveConfig('plugin.a', fields, { apiUrl: 'https://api.example.com/v2' });

        const record = await repo.get('plugin.a');
        expect(record?.secrets.apiKey).toBe(firstCiphertext);
        expect(record?.config).toEqual({ apiUrl: 'https://api.example.com/v2' });
        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({ apiKey: 'super-secret' });
    });

    it('clears a secret when the submission explicitly blanks it', async () => {
        const { service: svc } = service();

        await svc.saveConfig('plugin.a', fields, { apiUrl: 'https://api.example.com', apiKey: 'super-secret' });
        const result = await svc.saveConfig('plugin.a', fields, { apiUrl: 'https://api.example.com', apiKey: '' });

        expect(result.configured).toEqual({ apiKey: false });
        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({});
    });
});

describe('PluginConfigService.getReadModel', () => {
    it('contains plain config and configured flags, and never the secret value plaintext or ciphertext', async () => {
        const { service: svc, repo } = service();
        const plaintext = 'super-secret-token';

        await svc.saveConfig('plugin.a', fields, { apiUrl: 'https://api.example.com', apiKey: plaintext });
        const ciphertext = (await repo.get('plugin.a'))?.secrets.apiKey;
        expect(ciphertext).toBeDefined();

        const readModel = await svc.getReadModel('plugin.a', fields);
        const serialized = JSON.stringify(readModel);

        expect(readModel.config).toEqual({ apiUrl: 'https://api.example.com' });
        expect(readModel.configured).toEqual({ apiKey: true });
        expect(serialized).not.toContain(plaintext);
        expect(serialized).not.toContain(ciphertext as string);
    });

    it('reports configured: false and an empty config for a plugin that was never configured', async () => {
        const { service: svc } = service();

        const readModel = await svc.getReadModel('plugin.never', fields);

        expect(readModel).toMatchObject({ pluginId: 'plugin.never', enabled: false, config: {}, configured: { apiKey: false } });
    });

    it('reports oauthConnected: false when the OAuth vault key holds no value', async () => {
        const { service: svc } = service();

        await svc.saveConfig('plugin.a', fields, { apiUrl: 'https://api.example.com', apiKey: 'super-secret' });
        const readModel = await svc.getReadModel('plugin.a', fields);

        expect(readModel.oauthConnected).toBe(false);
    });

    it('reports oauthConnected: true when the OAuth vault key holds a non-empty value, without leaking it', async () => {
        const { service: svc, repo } = service();
        const oauthTokenBlob = 'ciphertext-for-oauth-tokens';

        await svc.saveConfig('plugin.a', fields, { apiUrl: 'https://api.example.com' });
        const record = await repo.get('plugin.a');
        await repo.upsert({ pluginId: 'plugin.a', secrets: { ...record?.secrets, [PLUGIN_OAUTH_SECRET_KEY]: oauthTokenBlob } });

        const readModel = await svc.getReadModel('plugin.a', fields);

        expect(readModel.oauthConnected).toBe(true);
        expect(JSON.stringify(readModel)).not.toContain(oauthTokenBlob);
    });

    it('reports oauthConnected: false for a plugin that was never configured', async () => {
        const { service: svc } = service();

        const readModel = await svc.getReadModel('plugin.never', fields);

        expect(readModel.oauthConnected).toBe(false);
    });

    it('treats an empty-string OAuth vault value as not connected', async () => {
        const { service: svc, repo } = service();

        await svc.saveConfig('plugin.a', fields, { apiUrl: 'https://api.example.com' });
        const record = await repo.get('plugin.a');
        await repo.upsert({ pluginId: 'plugin.a', secrets: { ...record?.secrets, [PLUGIN_OAUTH_SECRET_KEY]: '' } });

        const readModel = await svc.getReadModel('plugin.a', fields);

        expect(readModel.oauthConnected).toBe(false);
    });
});

describe('PluginConfigService.getConfig', () => {
    it('never includes secret keys', async () => {
        const { service: svc } = service();

        await svc.saveConfig('plugin.a', fields, { apiUrl: 'https://api.example.com', apiKey: 'super-secret' });

        const config = await svc.getConfig('plugin.a');

        expect(config).toEqual({ apiUrl: 'https://api.example.com' });
        expect(Object.keys(config)).not.toContain('apiKey');
    });
});
