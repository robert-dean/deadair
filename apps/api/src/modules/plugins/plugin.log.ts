import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { PluginLogger } from '@deadair/plugin-sdk';
// `RotatingLogStore` has to be a value import, not `import type`: it is a constructor
// parameter, and a type-only import is erased before `emitDecoratorMetadata` runs, so
// injectkit sees `Object` for that slot and fails registration verification.
import { RotatingLogStore } from '#src/logging/rotating.log.store.js';
import type { LogEntry } from '#src/logging/rotating.log.store.js';
import type { PluginLogLevel } from './types/plugins.types.js';

/** Minimum-severity ordering for the file-only verbosity gate. Console output ignores this entirely. */
const LEVEL_ORDER: Record<PluginLogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

/**
 * The file verbosity {@link PluginLog} falls back to for a plugin that has
 * never called `setLevel`, and the value `setLevel(id, undefined)` restores.
 *
 * Constructor-injected exactly like `PluginHostFactoryOptions` /
 * `PluginLoaderOptions`: `PLUGIN_LOG_LEVEL` is an env-sourced primitive, and
 * wrapping it in its own `@Injectable()` class is how this module hands a
 * plain value to the container without the consuming class touching
 * `AppConfig` itself.
 */
@Injectable()
export class PluginLogOptions {
    constructor(readonly defaultLevel: PluginLogLevel = 'info') {}
}

/**
 * The plugins module's single logging entry point.
 *
 * `for(pluginId)` returns a `PluginLogger` that tees every call to two
 * sinks: the app `Logger` (so plugin output keeps landing in `logs/api.log`
 * and on stdout, byte-for-byte what `PluginHostFactory.createLogger`
 * produced before this class existed) and the plugin's own rotating file via
 * `RotatingLogStore`, gated by that plugin's in-memory verbosity. The
 * unscoped passthrough methods exist for module-wide lines that belong to no
 * single plugin; they reach the app `Logger` only.
 *
 * Registered as a singleton (package 09), for the same reason `PluginRegistry`
 * and `PluginInvoker` already are: `RotatingLogStore` owns
 * a `Map<channel, WriteStream>`, and a second, request-scoped `PluginLog`
 * would open a second writable stream onto the same plugin's log file,
 * handing that channel two independent size counters and two rotations
 * racing each other. `PluginConfigRepository` and its siblings are scoped
 * instead because they ride a request-scoped DB connection; this class
 * touches no DB, so nothing forces it onto a scope, and singleton is the only
 * safe choice for anything that owns a file handle.
 */
@Injectable()
export class PluginLog {
    /** In-memory file verbosity per plugin id. A missing entry means "use the default". */
    private readonly levels = new Map<string, PluginLogLevel>();

    constructor(
        private readonly logger: Logger,
        private readonly store: RotatingLogStore,
        private readonly options: PluginLogOptions,
    ) {}

    /**
     * A `PluginLogger` scoped to `pluginId`, teeing every call to the app
     * `Logger` and to the plugin's own log file. Returns exactly the SDK's
     * `PluginLogger` shape: no widening, no extra methods.
     */
    for(pluginId: string): PluginLogger {
        return {
            debug: (message, meta) => this.emit(pluginId, 'debug', message, meta),
            info: (message, meta) => this.emit(pluginId, 'info', message, meta),
            warn: (message, meta) => this.emit(pluginId, 'warn', message, meta),
            error: (message, meta) => this.emit(pluginId, 'error', message, meta),
        };
    }

    /** Unscoped passthrough for a module-wide line that belongs to no single plugin. Reaches the app `Logger` only, never a plugin channel. */
    debug(message: string, meta?: Record<string, unknown>): void {
        this.logger.debug(message, meta);
    }

    /** Unscoped passthrough for a module-wide line that belongs to no single plugin. Reaches the app `Logger` only, never a plugin channel. */
    info(message: string, meta?: Record<string, unknown>): void {
        this.logger.info(message, meta);
    }

    /** Unscoped passthrough for a module-wide line that belongs to no single plugin. Reaches the app `Logger` only, never a plugin channel. */
    warn(message: string, meta?: Record<string, unknown>): void {
        this.logger.warn(message, meta);
    }

    /** Unscoped passthrough for a module-wide line that belongs to no single plugin. Reaches the app `Logger` only, never a plugin channel. */
    error(message: string, meta?: Record<string, unknown>): void {
        this.logger.error(message, meta);
    }

    /**
     * Sets `pluginId`'s in-memory file verbosity. `undefined` clears it back
     * to the injected default (`PLUGIN_LOG_LEVEL`), which is also what a
     * freshly booted process sees before anything calls this at all:
     * `PluginLifecycleManager` is what pushes a persisted value back in, on
     * both boot and reload-listener reinit, which is what makes the toggle
     * survive a restart.
     */
    setLevel(pluginId: string, level: PluginLogLevel | undefined): void {
        if (level === undefined) {
            this.levels.delete(pluginId);
            return;
        }
        this.levels.set(pluginId, level);
    }

    /** `pluginId`'s effective file verbosity: its own stored level, or the injected default. */
    levelOf(pluginId: string): PluginLogLevel {
        return this.levels.get(pluginId) ?? this.options.defaultLevel;
    }

    /** Delegates to the store, so a caller reaches a plugin's log history through `PluginLog` alone, never past it into the store directly. */
    tail(pluginId: string, options?: { limit?: number; level?: PluginLogLevel }): Promise<LogEntry[]> {
        return this.store.tail(pluginId, options);
    }

    /** Delegates to the store, so a caller reaches a plugin's log download through `PluginLog` alone, never past it into the store directly. */
    readAll(pluginId: string): Promise<string> {
        return this.store.readAll(pluginId);
    }

    /**
     * Tees one line for `pluginId`: unconditionally to the app `Logger`, and
     * to the store only when `level` clears that plugin's verbosity gate.
     * The console must never lose a line to the file's verbosity setting,
     * which is why this is two independent writes rather than one shared one
     * with a single early return.
     *
     * The store copy omits `plugin` from its meta: the file is already
     * scoped to this plugin's own channel, so repeating the tag on every
     * line would be redundant. The app `Logger` copy keeps it, unchanged from
     * `PluginHostFactory.createLogger`'s `{ ...meta, plugin: pluginId }`,
     * because that stream interleaves every plugin (and the host itself) and
     * needs the tag to attribute a line.
     */
    private emit(pluginId: string, level: PluginLogLevel, message: string, meta?: Record<string, unknown>): void {
        this.logger[level](message, { ...meta, plugin: pluginId });

        if (LEVEL_ORDER[level] < LEVEL_ORDER[this.levelOf(pluginId)]) return;
        this.store.append(pluginId, level, message, meta);
    }
}
