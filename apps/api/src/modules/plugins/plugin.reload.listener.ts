import { Injectable } from 'injectkit';
import pg from 'pg';
import type { ClientConfig, Notification } from 'pg';
import { Logger } from '@maroonedsoftware/logger';
import { PluginEchoTracker } from './plugin.echo.tracker.js';
import { PluginLifecycleManager } from './plugin.lifecycle.manager.js';

/** Channel the `deadair.plugin_configs` trigger notifies on. Set by migration 0005. */
export const PLUGIN_RELOAD_CHANNEL = 'deadair_plugins_changed';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Connection details for the listener's own `pg.Client`. Constructor-injected
 * (like the loader's and host factory's options) so this file never touches
 * `AppConfig`.
 */
@Injectable()
export class PluginReloadListenerOptions {
    constructor(
        readonly connection: ClientConfig,
        readonly channel: string = PLUGIN_RELOAD_CHANNEL,
    ) {}
}

/**
 * Applies plugin configuration changes to the running process.
 *
 * `LISTEN` monopolises a connection for its whole lifetime, so this takes a
 * dedicated client rather than borrowing from the query pool: a checked-out
 * pool connection that never returns is a pool one connection smaller forever.
 *
 * Nothing in here is allowed to reach the process. A listener that cannot
 * connect degrades the server to "config changes need a restart", which is a
 * far better outcome than a crash loop, so every failure path ends in a log
 * line and a scheduled retry.
 */
@Injectable()
export class PluginReloadListener {
    private client?: pg.Client;
    private reconnectTimer?: NodeJS.Timeout;
    private attempt = 0;
    private stopped = true;

    constructor(
        private readonly options: PluginReloadListenerOptions,
        private readonly pluginLifecycleManager: PluginLifecycleManager,
        private readonly pluginEchoTracker: PluginEchoTracker,
        private readonly logger: Logger,
    ) {}

    /** Connects and starts listening. Resolves even when the connection failed. */
    async start(): Promise<void> {
        if (!this.stopped) return;
        this.stopped = false;
        this.attempt = 0;
        await this.connect();
    }

    /** Stops listening and closes the connection. Safe to call when never started. */
    async stop(): Promise<void> {
        this.stopped = true;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }

        const client = this.client;
        this.client = undefined;
        if (!client) return;

        try {
            await client.end();
        } catch (error) {
            this.logger.debug('plugin reload listener closed with an error', { error: errorText(error) });
        }
    }

    private async connect(): Promise<void> {
        if (this.stopped) return;

        const client = new pg.Client(this.options.connection);
        // Both handlers must be attached before connect(): an `error` with no
        // listener on an EventEmitter is an unhandled throw.
        client.on('error', error => this.handleDrop(client, `connection error: ${errorText(error)}`));
        client.on('end', () => this.handleDrop(client, 'connection closed'));
        client.on('notification', notification => this.handleNotification(notification));

        try {
            await client.connect();
            await client.query(`LISTEN ${pg.escapeIdentifier(this.options.channel)}`);
        } catch (error) {
            this.logger.warn('plugin reload listener could not connect', { channel: this.options.channel, error: errorText(error) });
            try {
                await client.end();
            } catch {
                // Already dead; nothing to release.
            }
            this.scheduleReconnect();
            return;
        }

        this.client = client;
        this.attempt = 0;
        this.logger.info('listening for plugin configuration changes', { channel: this.options.channel });
    }

    /**
     * Reacts to a drop only when it belongs to the connection currently in use:
     * `end` also fires for the client we deliberately replaced or closed, and
     * reconnecting on those would multiply connections.
     */
    private handleDrop(client: pg.Client, reason: string): void {
        if (this.client !== client) return;
        this.client = undefined;
        if (this.stopped) return;

        this.logger.warn('plugin reload listener lost its connection', { reason });
        this.scheduleReconnect();
    }

    private handleNotification(notification: Notification): void {
        if (notification.channel !== this.options.channel) return;

        const pluginId = notification.payload?.trim();
        if (!pluginId) return;

        // Every host-originated write to `plugin_configs` (a status write, an
        // OAuth token refresh, a settings PUT) fires the same trigger and
        // announces itself to the tracker first. Reinitializing on those would
        // loop, or would duplicate an init the writer is already doing itself.
        // One expectation covers one notification, so an external write with
        // none pending still reloads the plugin.
        if (this.pluginEchoTracker.consumeEcho(pluginId)) {
            this.logger.debug('ignoring plugin notification from our own write', { plugin: pluginId });
            return;
        }

        this.logger.info('plugin configuration changed; reinitializing', { plugin: pluginId });
        void this.pluginLifecycleManager
            .reinitPlugin(pluginId)
            .catch(error => this.logger.error('plugin reinitialization failed', { plugin: pluginId, error: errorText(error) }));
    }

    /** Capped exponential backoff with jitter, so a restarted database is not stampeded. */
    private scheduleReconnect(): void {
        if (this.stopped || this.reconnectTimer) return;

        const backoff = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
        const delay = Math.round(backoff / 2 + Math.random() * (backoff / 2));
        this.attempt += 1;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            void this.connect();
        }, delay);
        // A pending retry must never be the reason the process stays alive.
        this.reconnectTimer.unref?.();
    }
}
