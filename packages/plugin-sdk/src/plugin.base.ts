import { PluginError } from './plugin.error.js';
import type { PluginHost } from './plugin.host.js';
import type { PluginLifecycle } from './plugin.lifecycle.js';

/** Undoes one thing a plugin set up. Run in reverse order of registration when the plugin unloads. */
export type PluginDisposer = () => void | Promise<void>;

/**
 * The base a plugin extends, so unloading is correct by construction.
 *
 * Two jobs, both of them chores every plugin was otherwise doing by hand:
 *
 * 1. **`this.host` is there or it throws with a sentence.** Each plugin used to
 *    hold `host?: PluginHost` and write its own `hostOrThrow()`, or forget to
 *    and get a `TypeError` about reading a property of undefined instead.
 * 2. **Teardown is registered next to setup.** {@link Plugin.register} takes an
 *    undo, and the base runs every one on unload, last registered first,
 *    whether or not {@link Plugin.onUnload} throws.
 *
 * The second matters MORE in this host, not less. Plugins run inside the API process
 * (`packages/plugin-sdk/CLAUDE.md` § "Trust and egress"), so a timer or a socket a plugin forgets
 * is not confined to a sandbox that gets torn down: it lives in the server until somebody restarts
 * it. Reloading a plugin on every config change is a normal thing an operator does, so "forgets on
 * unload" compounds.
 *
 * ```ts
 * class MyPlugin extends Plugin implements EnrichmentPluginInstance {
 *     protected async onLoad(): Promise<void> {
 *         const timer = setInterval(() => void this.refresh(), 60_000);
 *         this.register(() => clearInterval(timer));
 *     }
 * }
 * ```
 *
 * Extending this is optional: the host only ever asks for `PluginLifecycle`, so
 * a plugin that implements `init` and `dispose` itself is as valid as it was.
 */
export abstract class Plugin implements PluginLifecycle {
    private currentHost?: PluginHost;
    private readonly disposers: PluginDisposer[] = [];

    /**
     * The host, once `init` has run.
     *
     * A getter rather than a field so the failure is a sentence naming the
     * plugin instead of a `TypeError` from somewhere three calls deeper.
     *
     * @throws {PluginError} `internal` when read before `init` or after
     *   `dispose`. Both are host bugs rather than operator ones, which is what
     *   that code means.
     */
    protected get host(): PluginHost {
        if (this.currentHost === undefined) {
            throw new PluginError(`${this.constructor.name} was used before init() or after dispose()`).withCode('internal');
        }
        return this.currentHost;
    }

    /**
     * Registers something to undo when this plugin unloads.
     *
     * Call it next to the setup it undoes, which is the whole point: a
     * `clearInterval` written beside its `setInterval` is one that cannot drift
     * away from it as the file grows.
     */
    protected register(disposer: PluginDisposer): void {
        this.disposers.push(disposer);
    }

    /** {@link Plugin.register} for the common case. Works for `setTimeout` and `setInterval` alike. */
    protected registerTimer(timer: ReturnType<typeof setTimeout>): void {
        this.register(() => clearTimeout(timer));
    }

    /** Your setup. Called once, after `this.host` is available and before any capability method. */
    protected onLoad(): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Anything left to undo that `register` could not express, such as dropping
     * a cache. Runs after every registered disposer.
     */
    protected onUnload(): Promise<void> {
        return Promise.resolve();
    }

    async init(host: PluginHost): Promise<void> {
        this.currentHost = host;
        await this.onLoad();
    }

    /**
     * Undoes everything, in reverse.
     *
     * Every disposer runs even if an earlier one throws, because one broken
     * undo must not strand the rest: the failure is logged and the walk
     * continues. `onUnload` runs afterwards for the same reason it exists, and
     * `this.host` is released last so both still have it.
     *
     * Idempotent. The host calls it on unload, on a config change and at
     * shutdown, and those can overlap.
     */
    async dispose(): Promise<void> {
        if (this.currentHost === undefined) return;

        for (const disposer of this.disposers.splice(0).reverse()) {
            try {
                await disposer();
            } catch (error) {
                this.currentHost.logger.warn('a plugin disposer failed', {
                    plugin: this.constructor.name,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        try {
            await this.onUnload();
        } finally {
            this.currentHost = undefined;
        }
    }
}
