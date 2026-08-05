import type { Logger } from '@maroonedsoftware/logger';
import type { RotatingLogStore } from './rotating.log.store.js';

/**
 * Wraps another {@link Logger} and tees every call to both the wrapped logger (stdout,
 * unchanged) and a {@link RotatingLogStore}'s `logs/api.log` channel, so the API's own log is
 * retrievable without shell access to the container's stdout. There is no level gate here:
 * every level, `trace` included, reaches the file.
 */
export class DeadairLogger implements Logger {
    constructor(
        private readonly inner: Logger,
        private readonly store: RotatingLogStore,
    ) {}

    error(message: unknown, ...optionalParams: unknown[]): void {
        this.inner.error(message, ...optionalParams);
        this.append('error', message, optionalParams);
    }

    warn(message: unknown, ...optionalParams: unknown[]): void {
        this.inner.warn(message, ...optionalParams);
        this.append('warn', message, optionalParams);
    }

    info(message: unknown, ...optionalParams: unknown[]): void {
        this.inner.info(message, ...optionalParams);
        this.append('info', message, optionalParams);
    }

    debug(message: unknown, ...optionalParams: unknown[]): void {
        this.inner.debug(message, ...optionalParams);
        this.append('debug', message, optionalParams);
    }

    trace(message: unknown, ...optionalParams: unknown[]): void {
        this.inner.trace(message, ...optionalParams);
        this.append('trace', message, optionalParams);
    }

    private append(level: string, message: unknown, optionalParams: unknown[]): void {
        const text = typeof message === 'string' ? message : String(message);
        const [meta] = optionalParams;
        const metaRecord = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : undefined;

        this.store.append(undefined, level, text, metaRecord);
    }
}
