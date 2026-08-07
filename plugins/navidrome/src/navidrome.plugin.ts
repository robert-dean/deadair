import { PluginError, type MusicProviderPluginInstance, type PluginConnectionResult, type PluginHost } from '@deadair/plugin-sdk';

import { SubsonicAuth } from './navidrome.auth.js';
import { SubsonicClient } from './navidrome.client.js';
import { configSchema, type NavidromeConfig } from './navidrome.manifest.js';
import type { PingResponse } from './navidrome.types.js';

export { navidromeManifest } from './navidrome.manifest.js';

/**
 * Navidrome as a deadair `music-provider`: an operator's own library, over the
 * Subsonic API that Navidrome and its relatives all speak.
 *
 * Named for the one server it is tested against rather than for the protocol.
 * The wire format is plain Subsonic and Airsonic, Gonic and LMS would very
 * likely work, but this plugin leans on things that are Navidrome's behaviour
 * rather than the spec's, so a generic name would promise compatibility nothing
 * here checks.
 *
 * The audio path is the ordinary one the SDK was designed around, and the
 * opposite of Spotify's: this plugin mints a URL that carries its own
 * credentials, the player downloads it directly, and no helper process is
 * involved. Nothing here plays audio, so it never declares `steer`; Subsonic's
 * `jukeboxControl` plays to the server machine's own soundcard, which is no use
 * to a station broadcasting to Icecast.
 */
export class NavidromePlugin implements MusicProviderPluginInstance {
    private host?: PluginHost;
    private client?: SubsonicClient;

    async init(host: PluginHost): Promise<void> {
        this.host = host;

        const config = configSchema.parse(await host.config.get()) as NavidromeConfig;
        const password = await host.secrets.get('password');
        if (!password) throw new PluginError('Navidrome password is not configured').withCode('config');

        this.client = new SubsonicClient(host, config.baseUrl, new SubsonicAuth(config.username, password));
        host.logger.info('navidrome ready', { server: config.baseUrl, user: config.username });
    }

    /**
     * `ping` is the whole protocol's health check, and it is authenticated, so a
     * success here proves the URL, the account and the password all at once.
     *
     * Failures are reported rather than thrown: this is the settings card's
     * button, and the operator is mid-typo. The message is theirs to act on.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        try {
            const body = await this.require().get<PingResponse>('ping.view');
            const server = [body.type, body.serverVersion].filter(part => part).join(' ');
            return { ok: true, message: server ? `Connected to ${server}.` : 'Connected.' };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    async dispose(): Promise<void> {
        this.client = undefined;
        this.host = undefined;
    }

    /** The client, or the honest error for being called before `init`. */
    private require(): SubsonicClient {
        if (!this.client) throw new PluginError('Navidrome plugin used before init()').withCode('config');
        return this.client;
    }
}
