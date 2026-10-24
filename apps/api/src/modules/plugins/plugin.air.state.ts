import { Injectable } from 'injectkit';
import type { PluginAir, PluginLogger } from '@deadair/plugin-sdk';
import { errorText } from '#modules/shared/error.text.js';
import type { StationBus } from '#modules/shared/station.bus.js';

type AirListener = (on: boolean) => void | Promise<void>;

/**
 * Whether the station is on air, held for `host.air` on the plugins' side of the module list.
 *
 * The fact belongs to playout: `PlayoutPusher.wantsAir` is the one place that asks for a programme
 * and an audience together. `plugins` registers long before `playout`, so it cannot ask the pusher,
 * and the pusher has no business knowing plugins exist. So the pusher says `air.wanted` on the
 * station bus and this remembers the last thing it said, which is `StationBus`'s reason for
 * existing and the whole of what this class does with it.
 *
 * Listeners are kept per plugin rather than in one set, so disposing a plugin can drop whatever it
 * forgot to unsubscribe, the same backstop `PluginHostFactory.closeOpenSockets` is for sockets.
 * A plugin reinitialized by a config save gets a new host, and with it a new set.
 *
 * Off until the first `air.wanted`, which the pusher publishes on its first pass whatever the
 * answer. A plugin initialized before that reads `false` and hears the change, which is the
 * direction to be wrong in for the case this exists for: a model is kept for a few seconds less,
 * not held on a station nobody is listening to.
 */
@Injectable()
export class PluginAirState {
    private on = false;
    private readonly listeners = new Map<string, Set<AirListener>>();

    /** Follow `air.wanted` on the bus. Returns the unsubscribe. */
    follow(bus: StationBus): () => void {
        return bus.subscribe('air.wanted', event => this.set(event.on));
    }

    /** Whether the station is on air right now. */
    isOn(): boolean {
        return this.on;
    }

    /**
     * Record the station's state and tell every plugin listening, if it changed.
     *
     * Each listener runs on a microtask of its own rather than in this frame, which is the pusher's
     * reconcile pass: nothing a plugin does on hearing the news may hold up the loop that keeps the
     * station on air, and a listener that throws or rejects is logged through that plugin's own log
     * and stops nobody else hearing it. It is deliberately not an invocation, so it has no deadline
     * and no breaker: a plugin that mishandles being told the station stood down has not failed at
     * anything the station asked of it.
     */
    set(on: boolean): void {
        if (on === this.on) return;
        this.on = on;

        for (const listeners of this.listeners.values()) {
            for (const listener of [...listeners]) {
                // Asked again at delivery, so a plugin disposed in between is not told.
                queueMicrotask(() => {
                    if (listeners.has(listener)) void listener(on);
                });
            }
        }
    }

    /** The `host.air` one plugin is handed. Its listeners are dropped by {@link release}. */
    hostFor(pluginId: string, logger: PluginLogger): PluginAir {
        const listeners = new Set<AirListener>();
        this.listeners.set(pluginId, listeners);

        return {
            isOn: () => this.on,
            onChange: listener => {
                const wrapped: AirListener = on => this.call(listener, on, logger);
                listeners.add(wrapped);
                return () => {
                    listeners.delete(wrapped);
                };
            },
        };
    }

    /**
     * Drop every listener a plugin still holds. Called when the plugin is disposed.
     *
     * Safe to call for a plugin that never listened, and safe to call twice.
     */
    release(pluginId: string): void {
        this.listeners.get(pluginId)?.clear();
        this.listeners.delete(pluginId);
    }

    private async call(listener: AirListener, on: boolean, logger: PluginLogger): Promise<void> {
        try {
            await listener(on);
        } catch (error) {
            logger.warn(`a host.air listener threw on the station going ${on ? 'on' : 'off'} air`, { error: errorText(error) });
        }
    }
}
