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

    /**
     * Writes one line to the store, keeping whatever the caller actually passed.
     *
     * This used to be `String(message)`, which threw away the two things most
     * worth having:
     *
     * - an `Error` handed in as the message became `Error: <sentence>` with no
     *   stack, so a failure logged this way could not be traced to a call site.
     *   `Transaction is already committed` sat in the log for days for exactly
     *   this reason.
     * - any other object became the literal `[object Object]`. Five pino-style
     *   `logger.warn({ err }, 'message')` calls wrote 28 unreadable lines that
     *   way, discarding both the error and the sentence.
     *
     * Both call-site classes are fixed, but the store is where the damage was
     * irreversible, so it defends itself rather than trusting every future
     * caller to hold it right.
     */
    private append(level: string, message: unknown, optionalParams: unknown[]): void {
        const [meta] = optionalParams;
        const metaRecord = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...(meta as Record<string, unknown>) } : undefined;

        if (typeof message === 'string') {
            this.store.append(undefined, level, message, metaRecord);
            return;
        }

        if (message instanceof Error) {
            const stack = appFrames(message.stack);
            this.store.append(undefined, level, message.message, {
                ...metaRecord,
                errorName: message.name,
                ...(stack === undefined ? {} : { stack }),
            });
            return;
        }

        this.store.append(undefined, level, describe(message), metaRecord);
    }
}

/**
 * The frames of a stack that name OUR code.
 *
 * A raw stack is mostly framework and driver frames, and the store truncates a
 * long value, so the whole of a Kysely error's stack fits inside the cap
 * without ever reaching the call site that caused it. Vendor frames are dropped
 * and only the app's own are kept, which is the part anybody reading the log is
 * looking for. If a stack is ENTIRELY vendor (a failure raised inside a driver
 * with no app frame on it) the first few are kept, because something is better
 * than an empty field.
 */
function appFrames(stack: string | undefined, limit = 6): string | undefined {
    if (stack === undefined) return undefined;

    const frames = stack
        .split('\n')
        .slice(1)
        .map(line => line.trim())
        .filter(line => line.startsWith('at '));
    if (frames.length === 0) return undefined;

    const own = frames.filter(line => !line.includes('node_modules') && !line.includes('node:internal'));
    const kept = own.length > 0 ? own : frames;

    return kept.slice(0, limit).join(' <- ');
}

/**
 * A readable rendering of a non-string, non-Error message.
 *
 * JSON where it can be, `String()` where it cannot (a circular object, a
 * BigInt), because a log line that says something imperfect beats one that says
 * `[object Object]`.
 */
function describe(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';

    try {
        const json = JSON.stringify(value);
        return json === undefined ? String(value) : json;
    } catch {
        return String(value);
    }
}
