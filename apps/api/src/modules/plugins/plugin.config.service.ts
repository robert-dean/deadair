import { Injectable } from 'injectkit';
import type { DateTime } from 'luxon';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { ConfigField } from '@deadair/plugin-sdk';
import { PluginConfigRecord, PluginConfigRepository } from './plugin.config.repository.js';
import { PLUGIN_OAUTH_SECRET_KEY } from './plugin.oauth.secret.js';
import { PluginLogLevel } from './types/plugins.types.js';

/**
 * What the settings UI is allowed to see. Secret fields are reduced to a
 * `configured` boolean: neither the plaintext nor the stored ciphertext ever
 * leaves this service in a read model.
 */
export interface PluginConfigReadModel {
    pluginId: string;
    enabled: boolean;
    /** Plain (non-secret) values only. */
    config: Record<string, unknown>;
    /** One entry per `secret` field: whether a value is currently stored. */
    configured: Record<string, boolean>;
    /** Whether the reserved OAuth vault key holds a value. */
    oauthConnected: boolean;
    status?: string;
    lastError?: string;
    /** Per-plugin override of the log level. Absent means "use the configured default". */
    logLevel?: string;
    /** When this plugin was first ever enabled. Absent means it never has been. */
    firstEnabledAt?: DateTime;
}

/** `note` fields are static help text, not inputs, so they never carry a value. */
const isStoredPlainField = (field: ConfigField): boolean => field.type !== 'secret' && field.type !== 'note';

const isSecretField = (field: ConfigField): boolean => field.type === 'secret';

/** An explicitly blank submission clears a secret; an omitted one keeps it. */
const isClearedSecret = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

@Injectable()
export class PluginConfigService {
    constructor(
        private readonly pluginConfigRepository: PluginConfigRepository,
        private readonly encryptionProvider: EncryptionProvider,
    ) {}

    /**
     * Persist a submitted settings form, split by the manifest's field
     * descriptors: plain values go to `config`, `secret` values are encrypted
     * individually and go to `secrets`.
     *
     * A secret key absent from `submitted` keeps its existing ciphertext, so a
     * PUT never has to resubmit secrets the operator did not retype. A secret
     * key present but blank clears the stored value. Keys with no matching
     * descriptor are ignored.
     */
    async saveConfig(pluginId: string, fields: ConfigField[], submitted: Record<string, unknown>): Promise<PluginConfigReadModel> {
        const existing = await this.pluginConfigRepository.get(pluginId);

        const config: Record<string, unknown> = {};
        for (const field of fields.filter(isStoredPlainField)) {
            if (Object.hasOwn(submitted, field.key)) {
                config[field.key] = submitted[field.key];
            } else if (existing && Object.hasOwn(existing.config, field.key)) {
                config[field.key] = existing.config[field.key];
            }
        }

        const secrets: Record<string, string> = { ...(existing?.secrets ?? {}) };
        for (const field of fields.filter(isSecretField)) {
            if (!Object.hasOwn(submitted, field.key)) continue;
            const value = submitted[field.key];
            if (isClearedSecret(value)) {
                delete secrets[field.key];
                continue;
            }
            secrets[field.key] = this.encryptionProvider.encrypt(String(value));
        }

        const saved = await this.pluginConfigRepository.upsert({ pluginId, config, secrets });
        return this.toReadModel(saved, fields);
    }

    /** Plain (non-secret) config values. Safe to hand to a plugin's `host.config`. */
    async getConfig(pluginId: string): Promise<Record<string, unknown>> {
        const record = await this.pluginConfigRepository.get(pluginId);
        return record?.config ?? {};
    }

    /**
     * Decrypted secret values keyed by config-field key.
     *
     * For the host factory ONLY. Never log this, never put it in a response.
     */
    async getSecrets(pluginId: string): Promise<Record<string, string>> {
        const record = await this.pluginConfigRepository.get(pluginId);
        if (!record) return {};
        const secrets: Record<string, string> = {};
        for (const [key, ciphertext] of Object.entries(record.secrets)) {
            secrets[key] = this.encryptionProvider.decrypt(ciphertext);
        }
        return secrets;
    }

    /** The response-safe view: plain config plus a `configured` flag per secret field. */
    async getReadModel(pluginId: string, fields: ConfigField[]): Promise<PluginConfigReadModel> {
        const record = await this.pluginConfigRepository.get(pluginId);
        return this.toReadModel(record ?? { pluginId, enabled: false, config: {}, secrets: {} }, fields);
    }

    async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
        await this.pluginConfigRepository.setEnabled(pluginId, enabled);
    }

    async setStatus(pluginId: string, status: string, lastError?: string): Promise<void> {
        await this.pluginConfigRepository.setStatus(pluginId, status, lastError);
    }

    /** Sets the per-plugin log level override, returning the saved config record. */
    async setLogLevel(pluginId: string, level?: PluginLogLevel): Promise<PluginConfigRecord> {
        return this.pluginConfigRepository.setLogLevel(pluginId, level);
    }

    private toReadModel(
        record: Pick<PluginConfigRecord, 'pluginId' | 'enabled' | 'config' | 'secrets'> &
            Partial<Pick<PluginConfigRecord, 'status' | 'lastError' | 'logLevel' | 'firstEnabledAt'>>,
        fields: ConfigField[],
    ): PluginConfigReadModel {
        const config: Record<string, unknown> = {};
        for (const field of fields.filter(isStoredPlainField)) {
            if (Object.hasOwn(record.config, field.key)) config[field.key] = record.config[field.key];
        }

        const configured: Record<string, boolean> = {};
        for (const field of fields.filter(isSecretField)) {
            const ciphertext = record.secrets[field.key];
            configured[field.key] = typeof ciphertext === 'string' && ciphertext.length > 0;
        }

        const oauthTokens = record.secrets[PLUGIN_OAUTH_SECRET_KEY];
        const oauthConnected = typeof oauthTokens === 'string' && oauthTokens.length > 0;

        return {
            pluginId: record.pluginId,
            enabled: record.enabled,
            config,
            configured,
            oauthConnected,
            status: record.status,
            lastError: record.lastError,
            logLevel: record.logLevel,
            firstEnabledAt: record.firstEnabledAt,
        };
    }
}
