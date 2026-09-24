import { Container, Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { InboundMessage } from '@deadair/plugin-sdk';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { MessagingCommands } from './messaging.commands.js';
import { MessagingRepository } from './messaging.repository.js';
import { replyTo } from './messaging.reply.js';
import { MessagingService } from './messaging.service.js';

/**
 * How long one poll may wait for something to arrive.
 *
 * Under half a minute, because that is where the common proxies and NATs between a home server and
 * a platform start dropping idle connections, and long enough that a quiet bot costs two requests a
 * minute rather than one a second.
 */
export const MESSAGING_WAIT_MS = 25_000;

/** How often the poller looks for a platform that has appeared, recovered or been reconfigured. */
export const MESSAGING_SUPERVISE_MS = 10_000;

/** The first wait after a failed poll, doubled on each failure after it. */
export const MESSAGING_BACKOFF_FIRST_MS = 5_000;

/** The longest wait between failed polls. A platform down for an hour is asked twelve times. */
export const MESSAGING_BACKOFF_MAX_MS = 5 * 60_000;

/** How long a platform that is not accepting is left before it is asked again. */
const NOT_ACCEPTING_RECHECK_MS = 30_000;

/** The wait before poll number `failures + 1`, after `failures` in a row have failed. */
export const messagingBackoff = (failures: number): number =>
    Math.min(MESSAGING_BACKOFF_FIRST_MS * 2 ** Math.max(0, failures - 1), MESSAGING_BACKOFF_MAX_MS);

/** Resolves after `ms`, or as soon as `signal` aborts. Never rejects. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted) return resolve();
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
        function done() {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        }
    });
}

/**
 * `work`, or nothing as soon as `signal` aborts.
 *
 * What lets {@link MessagingPoller.stop} return without waiting out a long poll: the call into the
 * plugin is abandoned rather than awaited, and its eventual rejection is swallowed here because
 * nobody is left to hear it. The plugin's own disposal cancels whatever it still has open.
 */
async function unlessAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
    if (signal.aborted) {
        work.catch(() => undefined);
        return undefined;
    }

    let onAbort: (() => void) | undefined;
    const aborted = new Promise<undefined>(resolve => {
        onAbort = () => resolve(undefined);
        signal.addEventListener('abort', onAbort, { once: true });
    });

    try {
        return await Promise.race([work, aborted]);
    } finally {
        signal.removeEventListener('abort', onAbort!);
        work.catch(() => undefined);
    }
}

/**
 * Listening on every chat platform the station is connected to.
 *
 * ## A loop the station owns, because a plugin cannot push
 *
 * A plugin has no inbound HTTP and no way to call the station, so each `messaging` plugin is asked
 * for new messages in a loop here: one long poll at a time per platform, the cursor it returns stored
 * in `deadair.messaging_cursors`. A pg-boss cron is the usual home for work nobody is waiting on, and
 * it is the wrong one here because somebody IS waiting: a person who typed `/now` expects an answer
 * in seconds, and the broker's cron runs by the minute.
 *
 * ## One worker per platform, and a supervisor that owns none of their state
 *
 * A worker runs while its plugin is active and ends on its own when it is not: uninstalled,
 * quarantined by the invoker's breaker after three failed polls, or mid-reinit after a config save.
 * The supervisor looks every {@link MESSAGING_SUPERVISE_MS} for an active platform with no worker
 * and starts one. That is the whole of recovery: the breaker's own probe brings a plugin back to
 * `active`, and the next look finds it.
 *
 * ## At least once, not exactly once
 *
 * The cursor is saved after a batch has been answered, so a restart in between answers that batch
 * again. The alternative, saving first, loses a command instead of repeating an answer, and a
 * repeated "now playing" is the cheaper mistake.
 */
@Injectable()
export class MessagingPoller {
    private controller?: AbortController;
    private supervisor?: ReturnType<typeof setInterval>;
    private readonly workers = new Map<string, Promise<void>>();

    constructor(
        private readonly container: Container,
        private readonly messaging: MessagingService,
        private readonly commands: MessagingCommands,
        private readonly logger: Logger,
    ) {}

    /** Begin listening. Idempotent. */
    start(): void {
        if (this.controller !== undefined) return;

        this.controller = new AbortController();
        this.supervise();
        this.supervisor = setInterval(() => this.supervise(), MESSAGING_SUPERVISE_MS);
        this.supervisor.unref?.();
    }

    /**
     * Stop listening, and wait for every worker to let go of its platform.
     *
     * Prompt: a worker mid-poll abandons the call rather than waiting out up to half a minute of the
     * platform's long poll, which would otherwise be half a minute added to every shutdown.
     */
    async stop(): Promise<void> {
        if (this.supervisor !== undefined) clearInterval(this.supervisor);
        this.supervisor = undefined;
        this.controller?.abort();
        this.controller = undefined;

        await Promise.allSettled([...this.workers.values()]);
        this.workers.clear();
    }

    /** Start a worker for every active platform that has none. */
    private supervise(): void {
        const signal = this.controller?.signal;
        if (signal === undefined || signal.aborted) return;

        for (const platform of this.messaging.platforms()) {
            const pluginId = platform.record.id;
            if (this.workers.has(pluginId)) continue;

            const worker: Promise<void> = this.work(pluginId, signal)
                .catch(error => this.logger.warn(`messaging: stopped listening on ${pluginId} (${errorText(error)})`))
                // Only its own entry: after a stop and a start, the id may already be a newer worker's.
                .finally(() => {
                    if (this.workers.get(pluginId) === worker) this.workers.delete(pluginId);
                });
            this.workers.set(pluginId, worker);
        }
    }

    /** One platform's loop. Returns when the platform stops being active, or the poller stops. */
    private async work(pluginId: string, signal: AbortSignal): Promise<void> {
        let cursor = await this.readCursor(pluginId, signal);
        let failures = 0;

        while (!signal.aborted) {
            const platform = this.messaging.platform(pluginId);
            if (platform === undefined) return;

            if (!(await this.messaging.accepting(platform))) {
                await pause(NOT_ACCEPTING_RECHECK_MS, signal);
                continue;
            }

            let result;
            try {
                result = await unlessAborted(
                    this.messaging.receive(platform, { ...(cursor === undefined ? {} : { cursor }), waitMs: MESSAGING_WAIT_MS }),
                    signal,
                );
                if (result === undefined) return;
                failures = 0;
            } catch (error) {
                failures += 1;
                const waitMs = messagingBackoff(failures);
                // At info rather than warn: a platform that is down is the plugin's breaker's to
                // report, and it does, on the plugin's own page.
                this.logger.info(`messaging: could not poll ${pluginId}, trying again in ${Math.round(waitMs / 1000)}s (${errorText(error)})`);
                await pause(waitMs, signal);
                continue;
            }

            for (const message of result.messages) {
                if (signal.aborted) break;
                await this.respond(pluginId, message);
            }

            if (result.cursor !== undefined && result.cursor !== cursor) {
                cursor = result.cursor;
                await this.saveCursor(pluginId, cursor);
            }
        }
    }

    /**
     * Answer one message, if it wants an answer.
     *
     * Never throws: one message the station could not answer must not stop it hearing the next.
     */
    private async respond(pluginId: string, message: InboundMessage): Promise<void> {
        try {
            await this.commands.dispatch(pluginId, message, replyTo(this.messaging, this.commands.router.templates, this.logger, pluginId, message));
        } catch (error) {
            this.logger.warn(`messaging: could not answer a message on ${pluginId} (${errorText(error)})`);
        }
    }

    /** The saved cursor, retried until it can be read: starting from nothing would skip the backlog. */
    private async readCursor(pluginId: string, signal: AbortSignal): Promise<string | undefined> {
        let failures = 0;
        while (!signal.aborted) {
            try {
                return await inScope(this.container, scope => scope.get(MessagingRepository).readCursor(pluginId));
            } catch (error) {
                failures += 1;
                this.logger.warn(`messaging: could not read where ${pluginId} was up to (${errorText(error)})`);
                await pause(messagingBackoff(failures), signal);
            }
        }
        return undefined;
    }

    /**
     * Remember the cursor. A failure is logged and the loop carries on with it in memory, which is
     * only wrong across a restart, and then only by answering a batch twice.
     */
    private async saveCursor(pluginId: string, cursor: string): Promise<void> {
        try {
            await inScope(this.container, scope => scope.get(MessagingRepository).saveCursor(pluginId, cursor));
        } catch (error) {
            this.logger.warn(`messaging: could not save where ${pluginId} is up to (${errorText(error)})`);
        }
    }
}
