import type { PluginLogger } from './plugin.host.js';

/** A logger in the console's shape: a message and anything after it, which is what most client libraries take. */
export interface VariadicLogger {
    error(message: unknown, ...rest: unknown[]): void;
    warn(message: unknown, ...rest: unknown[]): void;
    info(message: unknown, ...rest: unknown[]): void;
    debug(message: unknown, ...rest: unknown[]): void;
    trace(message: unknown, ...rest: unknown[]): void;
}

/**
 * The plugin's logger in the shape a client library takes, so the library's own lines land in the
 * plugin's log under its name.
 *
 * The first thing after the message becomes the line's metadata when it is a plain object, and
 * anything else is dropped rather than stringified into the message. `trace` is written as `debug`,
 * which is the finest level the host keeps. Discord's and Slack's ServerKit clients each had this
 * adapter written into their plugin.
 */
export function variadicLogger(logger: PluginLogger): VariadicLogger {
    const meta = (rest: unknown[]): Record<string, unknown> | undefined => {
        const first = rest[0];
        return first !== null && typeof first === 'object' && !Array.isArray(first) ? (first as Record<string, unknown>) : undefined;
    };
    return {
        error: (message, ...rest) => logger.error(String(message), meta(rest)),
        warn: (message, ...rest) => logger.warn(String(message), meta(rest)),
        info: (message, ...rest) => logger.info(String(message), meta(rest)),
        debug: (message, ...rest) => logger.debug(String(message), meta(rest)),
        trace: (message, ...rest) => logger.debug(String(message), meta(rest)),
    };
}
