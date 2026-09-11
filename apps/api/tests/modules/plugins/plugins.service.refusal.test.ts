// What a refused save SAYS, and the reason it has to say it twice over. A plugin's schema refuses a
// combination — a provider chosen without the key it needs — and until this existed the 422 carried
// only one prose sentence under `message`. The console reads `details` as a map keyed by field, so
// it found nothing it recognised, put the message on no input, and suppressed its own alert on the
// grounds that the inputs had been told. The refusal was invisible on the one screen it exists for.

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { PluginManifest } from '@deadair/plugin-sdk';

import { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import { AuthorizationContext, type UserActor } from '../../../src/modules/permissions/authorization.context.js';
import type { PermissionsService } from '../../../src/modules/permissions/permissions.service.js';
import type { PluginConfigService } from '../../../src/modules/plugins/plugin.config.service.js';
import { AfterCommit } from '../../../src/modules/data/after.commit.js';
import { StationBus } from '../../../src/modules/shared/station.bus.js';
import { PluginInvoker } from '../../../src/modules/plugins/plugin.invoker.js';
import { PluginLifecycleManager } from '../../../src/modules/plugins/plugin.lifecycle.manager.js';
import { PluginOAuthStateStore } from '../../../src/modules/plugins/plugin.oauth.state.store.js';
import { PluginRegistry } from '../../../src/modules/plugins/plugin.registry.js';
import { PluginsService } from '../../../src/modules/plugins/plugins.service.js';
import type { PluginRecord } from '../../../src/modules/plugins/types/plugin.record.js';
import { stubPluginLog } from '../../utils/plugin.log.fixture.js';

const PLUGIN_ID = 'deadair.llm';

/** `plugins/llm`'s own shape, reduced to the arm that needs a key and the one that needs an address. */
const configSchema = z
    .object({ providerKind: z.string().optional(), baseUrl: z.string().optional(), apiKey: z.string().optional() })
    .refine(config => config.providerKind !== 'openai-compat' || (config.baseUrl ?? '').length > 0, {
        path: ['baseUrl'],
        message: 'An OpenAI-compatible endpoint needs its address',
    })
    .refine(config => config.providerKind !== 'anthropic' || (config.apiKey ?? '').length > 0, {
        path: ['apiKey'],
        message: 'This provider needs an API key',
    });

const userActor = (actorId: string): UserActor => ({ kind: 'user', sessionToken: 'test-session', actorId, factors: [], platformRoles: new Set() });

function manifest(schema: unknown): PluginManifest {
    return {
        id: PLUGIN_ID,
        name: 'Language model',
        version: '1.0.0',
        capabilities: ['llm'],
        apiVersion: '^1.0.0',
        permissions: { network: [], storage: false, oauth: false },
        configFields: [
            { key: 'providerKind', label: 'Provider', type: 'string' },
            { key: 'baseUrl', label: 'Server URL', type: 'url' },
            { key: 'apiKey', label: 'API key', type: 'secret' },
        ],
        configSchema: schema as PluginManifest['configSchema'],
    };
}

function makeService(schema: unknown = configSchema, saveConfig = vi.fn(async () => {})): PluginsService {
    const registry = new PluginRegistry();
    const record: PluginRecord = {
        id: PLUGIN_ID,
        dir: `/plugins/${PLUGIN_ID}`,
        origin: 'bundled',
        status: 'active',
        manifest: manifest(schema),
        instance: {} as never,
    };
    registry.upsert(record);

    const grants = new Set([`plugin:${PLUGIN_ID}:configure:u-owner`]);
    const permissions = {
        checkSubject: vi.fn(async (object: { namespace: string; id: string }, permission: string, subject: { id: string }) =>
            grants.has(`${object.namespace}:${object.id}:${permission}:${subject.id}`),
        ),
        listObjects: vi.fn(async () => ({ ids: [], truncated: false })),
    } as unknown as PermissionsService;

    const configService = {
        getReadModel: vi.fn(async (pluginId: string) => ({ pluginId, enabled: true, config: {}, configured: {}, oauthConnected: false })),
        getConfig: vi.fn(async () => ({})),
        getSecrets: vi.fn(async () => ({})),
        saveConfig,
        setEnabled: vi.fn(async () => {}),
        setLogLevel: vi.fn(async () => {}),
    } as unknown as PluginConfigService;

    return new PluginsService(
        registry,
        configService,
        new PluginInvoker(registry, stubPluginLog().log),
        { rescan: vi.fn(async () => {}), reinitPlugin: vi.fn(async () => {}) } as unknown as PluginLifecycleManager,
        new PluginOAuthStateStore(),
        { holds: () => false, decisionFor: () => undefined } as never,
        new AccessControlService(new AuthorizationContext(userActor('u-owner')), permissions),
        {
            for: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            setLevel: vi.fn(),
            levelOf: vi.fn(() => 'info'),
            tail: vi.fn(async () => []),
            readAll: vi.fn(async () => ''),
        } as never,
        new AfterCommit(),
        { send: vi.fn(async () => 'job-1') } as never,
        { actor: { kind: 'system', sessionToken: '', source: 'test' } } as never,
        { record: vi.fn(async () => undefined) } as never,
        { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        new StationBus({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never),
    );
}

/** The `details` off whatever the save threw. */
async function refusalDetails(config: Record<string, unknown>): Promise<Record<string, unknown>> {
    const service = makeService();
    const caught = await service.updatePluginConfig(PLUGIN_ID, { config }).catch((error: unknown) => error);
    return (caught as { details?: Record<string, unknown> }).details ?? {};
}

describe('a save a plugin schema refused', () => {
    it('names the field it refused, so the console can put the message on that input', async () => {
        expect(await refusalDetails({ providerKind: 'anthropic' })).toMatchObject({ apiKey: 'This provider needs an API key' });
    });

    it('names each refused field once', async () => {
        const details = await refusalDetails({ providerKind: 'openai-compat' });

        expect(details).toMatchObject({ baseUrl: 'An OpenAI-compatible endpoint needs its address' });
        expect(details.apiKey).toBeUndefined();
    });

    it('keeps the sentence, which is what a refusal naming no field still says', async () => {
        expect(await refusalDetails({ providerKind: 'anthropic' })).toMatchObject({
            message: expect.stringContaining('configuration is invalid') as unknown as string,
        });
    });

    it('says so plainly when the schema itself throws', async () => {
        const service = makeService({
            safeParse: () => {
                throw new Error('boom');
            },
        });

        const caught = await service.updatePluginConfig(PLUGIN_ID, { config: {} }).catch((error: unknown) => error);

        expect((caught as { details?: { message?: string } }).details?.message).toContain('could not be validated');
    });

    it('writes nothing at all', async () => {
        // The whole point of refusing before the write: a station whose plugin is mid-save into a
        // combination it cannot run is worse than one that was told no.
        const saveConfig = vi.fn(async () => {});
        const service = makeService(configSchema, saveConfig);

        await service.updatePluginConfig(PLUGIN_ID, { config: { providerKind: 'anthropic' } }).catch(() => undefined);

        expect(saveConfig).not.toHaveBeenCalled();
    });
});
