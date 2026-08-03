import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString } from '../sdk-options.js';
import type {
    PluginConfigInput,
    PluginDetail,
    PluginListQuery,
    PluginOAuthCallbackQuery,
    PluginOAuthResult,
    PluginOAuthStart,
    PluginSummary,
    PluginTestResult,
} from './types/plugins.types.js';

export class PluginsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List plugins
     * @description Lists every plugin the host knows about, optionally narrowed to one kind
     */
    async listPlugins(query?: PluginListQuery): Promise<PluginSummary[]> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/plugins${qs}`, {
            method: 'GET',
        });
        return await parseJson<PluginSummary[]>(result);
    }

    /**
     * @name Rescan plugins
     * @description Rescans the mounted plugin directory: registers new plugins, unloads removed ones
     */
    async rescanPlugins(): Promise<PluginSummary[]> {
        const result = await this.fetch(`/plugins/rescan`, { method: 'POST' });
        return await parseJson<PluginSummary[]>(result);
    }

    /**
     * @name Get plugin
     * @description One plugin, including its stored non-secret configuration and last error
     */
    async getPlugin(id: string): Promise<PluginDetail> {
        const result = await this.fetch(`/plugins/${encodeURIComponent(id)}`, { method: 'GET' });
        return await parseJson<PluginDetail>(result);
    }

    /**
     * @name Update plugin configuration
     * @description Validates against the plugin's own config schema, encrypts secrets, persists, and reinitializes
     */
    async updatePluginConfiguration(id: string, body: PluginConfigInput): Promise<PluginDetail> {
        const result = await this.fetch(`/plugins/${encodeURIComponent(id)}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<PluginDetail>(result);
    }

    /**
     * @name Enable plugin
     * @description Enables a plugin without resubmitting its configuration
     */
    async enablePlugin(id: string): Promise<PluginDetail> {
        const result = await this.fetch(`/plugins/${encodeURIComponent(id)}/enable`, { method: 'POST' });
        return await parseJson<PluginDetail>(result);
    }

    /**
     * @name Disable plugin
     * @description Disables a plugin and tears its instance down, keeping its configuration
     */
    async disablePlugin(id: string): Promise<PluginDetail> {
        const result = await this.fetch(`/plugins/${encodeURIComponent(id)}/disable`, { method: 'POST' });
        return await parseJson<PluginDetail>(result);
    }

    /**
     * @name Test plugin connection
     * @description Runs the plugin's own `testConnection()` through the invoker
     */
    async testPluginConnection(id: string): Promise<PluginTestResult> {
        const result = await this.fetch(`/plugins/${encodeURIComponent(id)}/test`, { method: 'POST' });
        return await parseJson<PluginTestResult>(result);
    }

    /**
     * @name Start plugin OAuth authorization
     * @description Reports where to send the operator for the provider's consent screen
     */
    async startPluginOAuthAuthorization(id: string): Promise<PluginOAuthStart> {
        const result = await this.fetch(`/plugins/${encodeURIComponent(id)}/oauth/authorize`, { method: 'GET' });
        return await parseJson<PluginOAuthStart>(result);
    }

    /**
     * @name Disconnect plugin OAuth
     * @description Forgets the plugin's stored OAuth tokens and reinitializes it
     */
    async disconnectPluginOAuth(id: string): Promise<PluginDetail> {
        const result = await this.fetch(`/plugins/${encodeURIComponent(id)}/oauth`, { method: 'DELETE' });
        return await parseJson<PluginDetail>(result);
    }

    /**
     * @name Complete plugin OAuth authorization
     * @description Completes the flow. Anonymous: the provider redirects the browser here with no session of ours
     */
    async completePluginOAuthAuthorization(id: string, query?: PluginOAuthCallbackQuery): Promise<PluginOAuthResult> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/plugins/${encodeURIComponent(id)}/oauth/callback${qs}`, {
            method: 'GET',
        });
        return await parseJson<PluginOAuthResult>(result);
    }
}
