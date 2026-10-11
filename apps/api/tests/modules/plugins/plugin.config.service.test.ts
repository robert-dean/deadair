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

    it('removes a plain value the submission sends as null, rather than storing the null', async () => {
        const { service: svc } = service();

        await svc.saveConfig('plugin.a', fields, { apiUrl: 'https://api.example.com' });
        const result = await svc.saveConfig('plugin.a', fields, { apiUrl: null });

        expect(result.config).toEqual({});
        await expect(svc.getConfig('plugin.a')).resolves.toEqual({});
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

describe('PluginConfigService: a credential inside a row', () => {
    const providers: ConfigField[] = [
        {
            key: 'providers',
            label: 'Providers',
            type: 'list',
            columns: [
                { key: 'name', label: 'Name', type: 'string' },
                { key: 'apiKey', label: 'API key', type: 'secret' },
            ],
        },
    ];

    const rows = (...entries: Record<string, unknown>[]): Record<string, unknown> => ({ providers: JSON.stringify(entries) });

    /** The rows as they were STORED, which is where the whole rule is visible. */
    const storedRows = (config: Record<string, unknown>): Record<string, unknown>[] => JSON.parse(String(config.providers));

    it('encrypts the cell, keeps it out of the row, and gives the row a name', async () => {
        const { service: svc, repo } = service();

        const result = await svc.saveConfig('plugin.a', providers, rows({ name: 'claude', apiKey: 'sk-live' }));

        const [row] = storedRows(result.config);
        expect(row?.name).toBe('claude');
        expect(row?.apiKey).toBeUndefined();
        expect(row?.$id).toEqual(expect.any(String));

        const stored = await repo.get('plugin.a');
        expect(JSON.stringify(stored?.config)).not.toContain('sk-live');
        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({ [`providers/${String(row?.$id)}/apiKey`]: 'sk-live' });
    });

    it('reports the cell as configured, under its own key and never as a value', async () => {
        const { service: svc } = service();

        const saved = await svc.saveConfig('plugin.a', providers, rows({ name: 'claude', apiKey: 'sk-live' }));
        const [row] = storedRows(saved.config);

        expect(saved.configured[`providers/${String(row?.$id)}/apiKey`]).toBe(true);
        expect(JSON.stringify(saved)).not.toContain('sk-live');
    });

    it('keeps the stored credential when a second save does not resend it', async () => {
        // The same contract a secret field has, which is what lets an operator edit the name in a
        // row without retyping the key beside it.
        const { service: svc } = service();

        const first = await svc.saveConfig('plugin.a', providers, rows({ name: 'claude', apiKey: 'sk-live' }));
        const [row] = storedRows(first.config);
        await svc.saveConfig('plugin.a', providers, rows({ $id: row?.$id, name: 'renamed' }));

        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({ [`providers/${String(row?.$id)}/apiKey`]: 'sk-live' });
    });

    it('clears the credential when the cell comes back null', async () => {
        const { service: svc } = service();

        const first = await svc.saveConfig('plugin.a', providers, rows({ name: 'claude', apiKey: 'sk-live' }));
        const [row] = storedRows(first.config);
        await svc.saveConfig('plugin.a', providers, rows({ $id: row?.$id, name: 'claude', apiKey: null }));

        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({});
    });

    it('forgets the credential of a row that was removed', async () => {
        const { service: svc } = service();

        await svc.saveConfig('plugin.a', providers, rows({ name: 'claude', apiKey: 'sk-live' }));
        await svc.saveConfig('plugin.a', providers, rows());

        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({});
    });

    it('keeps a row id stable across a save, so the credential stays with its row', async () => {
        const { service: svc } = service();

        const first = await svc.saveConfig('plugin.a', providers, rows({ name: 'a', apiKey: 'sk-a' }, { name: 'b', apiKey: 'sk-b' }));
        const [one, two] = storedRows(first.config);

        // Reordered, exactly as the console sends it after a drag.
        const second = await svc.saveConfig('plugin.a', providers, rows({ $id: two?.$id, name: 'b' }, { $id: one?.$id, name: 'a' }));

        expect(storedRows(second.config).map(row => row.name)).toEqual(['b', 'a']);
        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({
            [`providers/${String(one?.$id)}/apiKey`]: 'sk-a',
            [`providers/${String(two?.$id)}/apiKey`]: 'sk-b',
        });
    });
});

/** What a refused save threw, for asserting on the sentence each field gets. */
async function refusal(promise: Promise<unknown>): Promise<Record<string, unknown>> {
    try {
        await promise;
    } catch (error) {
        const caught = error as { statusCode?: number; details?: Record<string, unknown> };
        expect(caught.statusCode).toBe(422);
        return caught.details ?? {};
    }
    throw new Error('the save was not refused');
}

describe('PluginConfigService: a kept secret never follows a changed address', () => {
    const paired: ConfigField[] = [
        { key: 'baseUrl', label: 'Server', type: 'url' },
        { key: 'apiKey', label: 'API key', type: 'secret', sentTo: 'baseUrl' },
        { key: 'other', label: 'Other', type: 'secret' },
    ];

    it('refuses to keep the secret when the address moves to another server, and writes nothing', async () => {
        const { service: svc, repo } = service();
        await svc.saveConfig('plugin.a', paired, { baseUrl: 'https://jellyfin.home.example', apiKey: 'jf-key' });
        const before = await repo.get('plugin.a');

        const details = await refusal(svc.saveConfig('plugin.a', paired, { baseUrl: 'https://attacker.example' }));

        // Under the secret's own key, which is where the console's form puts a server message.
        expect(details.apiKey).toEqual(expect.stringContaining('Enter it again'));
        expect((await repo.get('plugin.a'))?.config).toEqual(before?.config);
        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({ apiKey: 'jf-key' });
    });

    it('keeps the secret across a path change on the same server', async () => {
        const { service: svc } = service();
        await svc.saveConfig('plugin.a', paired, { baseUrl: 'https://jellyfin.home.example', apiKey: 'jf-key' });

        await svc.saveConfig('plugin.a', paired, { baseUrl: 'https://jellyfin.home.example/jellyfin' });

        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({ apiKey: 'jf-key' });
    });

    it('saves a new address with a secret typed beside it', async () => {
        const { service: svc } = service();
        await svc.saveConfig('plugin.a', paired, { baseUrl: 'https://jellyfin.home.example', apiKey: 'jf-key' });

        await svc.saveConfig('plugin.a', paired, { baseUrl: 'https://media.example', apiKey: 'new-key' });

        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({ apiKey: 'new-key' });
    });

    it('leaves a secret that declares no address alone', async () => {
        const { service: svc } = service();
        await svc.saveConfig('plugin.a', paired, { baseUrl: 'https://jellyfin.home.example', other: 'unpaired' });

        await svc.saveConfig('plugin.a', paired, { baseUrl: 'https://attacker.example' });

        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({ other: 'unpaired' });
    });

    it('refuses a row that keeps its credential while its address moves, with the sentence on the list', async () => {
        const providers: ConfigField[] = [
            {
                key: 'providers',
                label: 'Providers',
                type: 'list',
                columns: [
                    { key: 'baseUrl', label: 'Address', type: 'url' },
                    { key: 'apiKey', label: 'API key', type: 'secret', sentTo: 'baseUrl' },
                ],
            },
        ];
        const { service: svc } = service();
        await svc.saveConfig('plugin.a', providers, {
            providers: JSON.stringify([{ $id: 'r1', baseUrl: 'http://ollama.local:11434/v1', apiKey: 'k' }]),
        });

        const details = await refusal(
            svc.saveConfig('plugin.a', providers, { providers: JSON.stringify([{ $id: 'r1', baseUrl: 'https://attacker.example/v1' }]) }),
        );

        expect(details.providers).toEqual(expect.stringContaining('API key'));
        await expect(svc.getSecrets('plugin.a')).resolves.toEqual({ 'providers/r1/apiKey': 'k' });
    });
});
