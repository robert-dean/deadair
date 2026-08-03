import { Injectable } from 'injectkit';

/**
 * How long an announced write stays suppressible.
 *
 * The window only guards against the echo never arriving (the listener being
 * disconnected at the moment of the write) leaving a stale suppression behind
 * that would later eat a genuine external change. It is not a "ignore
 * everything for N seconds" mute: each expectation covers exactly one
 * notification.
 */
const ECHO_WINDOW_MS = 10_000;

/**
 * The host's record of the `plugin_configs` writes it made itself.
 *
 * Every write to that table fires the `deadair_plugins_changed` trigger, so
 * without this the host's own writes come straight back as "configuration
 * changed" and reinitialize the plugin: a status write would loop forever, an
 * hourly OAuth token refresh would dispose the plugin mid-call, and a settings
 * PUT would run the plugin's `init` twice. A writer announces its write here
 * first, and {@link PluginReloadListener} consumes exactly one expectation per
 * notification.
 *
 * Deliberately dependency-free. Both the lifecycle manager and the host factory
 * announce their writes, and the lifecycle manager already depends on the host
 * factory, so anything the two of them share has to sit below both of them or
 * it closes a cycle.
 *
 * Time is plain `Date.now()` and there are no timers of its own, so tests can
 * fake-advance the clock across the window without anything to flush.
 */
@Injectable()
export class PluginEchoTracker {
    /** Plugin id -> timestamps of announced writes whose notifications are still expected. */
    private readonly pending = new Map<string, number[]>();

    /**
     * Announces `count` imminent writes to this plugin's row, each of which will
     * produce one notification.
     *
     * Call it BEFORE the write: a notification can be delivered while the
     * writing statement's promise is still settling, and an expectation
     * registered afterwards would arrive too late to cover it.
     */
    expectEcho(pluginId: string, count = 1): void {
        if (count <= 0) return;
        const now = Date.now();
        const entries = this.pending.get(pluginId) ?? [];
        for (let i = 0; i < count; i++) entries.push(now);
        this.pending.set(pluginId, entries);
    }

    /**
     * Whether a `deadair_plugins_changed` notification for `pluginId` is the
     * echo of a write this process announced, and should therefore not trigger a
     * reinit.
     *
     * Destructive: one expectation covers one notification, so a second
     * notification with nothing left pending is treated as a genuine external
     * change (an operator editing the table by hand still reloads the plugin).
     */
    consumeEcho(pluginId: string): boolean {
        const entries = this.prune(pluginId);
        if (entries === undefined) return false;

        // Oldest first: expectations are consumed in the order the writes were
        // announced, which is the order their notifications are delivered.
        entries.shift();
        if (entries.length === 0) this.pending.delete(pluginId);
        return true;
    }

    /**
     * Withdraws up to `count` of the most recently announced expectations, for a
     * write that was announced and then threw. Leaving it behind would silently
     * swallow the next genuine change instead.
     */
    retractEcho(pluginId: string, count = 1): void {
        if (count <= 0) return;
        const entries = this.pending.get(pluginId);
        if (entries === undefined) return;

        entries.splice(Math.max(0, entries.length - count), count);
        if (entries.length === 0) this.pending.delete(pluginId);
    }

    /** This plugin's live expectations, or `undefined` when it has none left. */
    private prune(pluginId: string): number[] | undefined {
        const entries = this.pending.get(pluginId);
        if (entries === undefined) return undefined;

        const cutoff = Date.now() - ECHO_WINDOW_MS;
        // Announced in ascending time order, so everything expired is a prefix.
        let expired = 0;
        while (expired < entries.length && entries[expired]! <= cutoff) expired++;
        if (expired > 0) entries.splice(0, expired);

        if (entries.length === 0) {
            this.pending.delete(pluginId);
            return undefined;
        }
        return entries;
    }
}
