import { Injectable } from 'injectkit';
import { PluginError, isResourceScopedCode, toPluginError } from '@deadair/plugin-sdk';
import { PluginLog } from './plugin.log.js';
import { PluginRegistry } from './plugin.registry.js';

/** How long a single call into plugin code may run before it is abandoned. */
export const PLUGIN_INVOKE_TIMEOUT_MS = 15_000;

/** Consecutive failures that trip the breaker and quarantine the plugin. */
export const PLUGIN_FAILURE_THRESHOLD = 3;

export interface PluginInvokeOptions {
    /** Overrides {@link PLUGIN_INVOKE_TIMEOUT_MS} for one call. */
    timeoutMs?: number;
}

/**
 * A `ServerkitError`'s `message` is the bare status text ("Forbidden") and the
 * useful sentence lives in `details.message`, so prefer that: the operator
 * reading a plugin's last error wants the sentence, not the status word.
 */
const errorText = (error: unknown): string => {
    if (!(error instanceof Error)) return String(error);
    const details = (error as { details?: Record<string, unknown> }).details;
    const detail = details?.message;
    return typeof detail === 'string' && detail.length > 0 ? detail : error.message;
};

interface InvokeDeadline {
    /** Handed to the plugin so well-behaved code can bail out early. */
    signal: AbortSignal;
    /** Rejects when the deadline passes, so code that ignores the signal is abandoned anyway. */
    expiry: Promise<never>;
    dispose: () => void;
}

/**
 * Deliberately an `AbortController` on a plain `setTimeout` rather than
 * `AbortSignal.timeout`: that one's internal timer is unref'd (so a process
 * with nothing else pending exits before it fires) and is invisible to fake
 * timers, which would make the deadline untestable.
 */
const deadline = (timeoutMs: number, message: string): InvokeDeadline => {
    const controller = new AbortController();
    let onAbort: () => void = () => {};

    const expiry = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new PluginError(message).withCode('timeout'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
    });

    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return {
        signal: controller.signal,
        expiry,
        dispose: () => {
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', onAbort);
        },
    };
};

/**
 * The single door every call into plugin code goes through.
 *
 * Plugin code is third-party code running in-process, so the two ways it can
 * hurt the server are hanging forever and throwing from somewhere nothing was
 * awaiting. This wrapper closes both: a timeout the plugin cannot opt out of
 * (the signal is passed in AND raced against, so ignoring it buys nothing), and
 * a catch-all that turns any throw into a recorded status.
 *
 * On top of that sits a consecutive-failure breaker. A plugin whose upstream is
 * down would otherwise be retried on every request forever, burning latency on
 * calls that cannot succeed; after {@link PLUGIN_FAILURE_THRESHOLD} failures in
 * a row (or one failure the plugin itself declared non-retryable) it is
 * quarantined and further calls fail immediately with the reason, until
 * something (a config change, a reinit) calls {@link PluginInvoker.reset}.
 *
 * Resource-scoped failures are exempt from all of that (see
 * `isResourceScopedCode`). "That playlist is not yours" is a correct answer
 * from a healthy plugin, and counting correct answers as failures is how a
 * working integration gets quarantined for being used normally.
 *
 * Everything thrown from here is a `PluginError`, so a caller can map the
 * failure to a response without parsing a message string.
 */
@Injectable()
export class PluginInvoker {
    /** Consecutive failures per plugin. Cleared by a success or a reset. */
    private readonly consecutiveFailures = new Map<string, number>();

    /** Plugins whose breaker is open, mapped to the reason it opened. */
    private readonly openBreakers = new Map<string, string>();

    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginLog: PluginLog,
    ) {}

    /**
     * Runs `fn` on behalf of `pluginId`, attributing anything that goes wrong to
     * `op` (e.g. `init`, `catalog.search`).
     *
     * `fn` receives the abort signal so well-behaved plugin code can bail early;
     * the call is abandoned at the timeout either way.
     *
     * @throws {PluginError} when the plugin's breaker is open (`unavailable`),
     *   when the call times out (`timeout`), or when `fn` rejects (the code the
     *   plugin gave, or `internal`). Never throws for any other reason: a
     *   plugin failure is data, not a crash.
     */
    async invoke<T>(pluginId: string, op: string, fn: (signal: AbortSignal) => Promise<T>, opts?: PluginInvokeOptions): Promise<T> {
        const openReason = this.openBreakers.get(pluginId);
        if (openReason !== undefined) {
            throw new PluginError(`plugin ${pluginId} is failed: ${openReason}`).withCode('unavailable');
        }

        const timeoutMs = opts?.timeoutMs ?? PLUGIN_INVOKE_TIMEOUT_MS;
        const timeout = deadline(timeoutMs, `plugin ${pluginId} timed out after ${timeoutMs}ms during ${op}`);

        try {
            // `fn` may throw synchronously; wrapping it keeps that on the same
            // path as a rejection instead of escaping the race entirely.
            const call = (async () => fn(timeout.signal))();
            const result = await Promise.race([call, timeout.expiry]);
            this.recordSuccess(pluginId);
            return result;
        } catch (error) {
            throw this.recordFailure(pluginId, op, error);
        } finally {
            timeout.dispose();
        }
    }

    /**
     * Closes the breaker and forgets the failure count. The lifecycle manager
     * calls this when a plugin is (re)initialized, so fixing the config is
     * enough to give a quarantined plugin another chance.
     */
    reset(pluginId: string): void {
        this.consecutiveFailures.delete(pluginId);
        this.openBreakers.delete(pluginId);
    }

    /** Whether calls to this plugin are currently short-circuiting. */
    isBreakerOpen(pluginId: string): boolean {
        return this.openBreakers.has(pluginId);
    }

    private recordSuccess(pluginId: string): void {
        this.consecutiveFailures.delete(pluginId);
    }

    /**
     * Records the failure on the registry record and returns the error to throw.
     *
     * The classification is preserved rather than flattened into a message: the
     * whole reason {@link PluginError} exists is that "expired token" and
     * "Spotify is down" have to still be distinguishable by the time the
     * service decides what to answer. A plugin that threw a bare `Error` is
     * classified `internal`, which behaves exactly as this did before.
     *
     * This is the one place in the host that adopts an error from plugin code,
     * which is why `toPluginError` is called here and nowhere downstream: past
     * this line every `PluginError` in flight is one the host built itself.
     * Only its classification is read; the outward message is rebuilt from
     * `errorText` either way.
     */
    private recordFailure(pluginId: string, op: string, error: unknown): PluginError {
        const pluginError = toPluginError(error);
        const message = errorText(error);
        const reason = `${op}: ${message}`;

        // A refusal about one resource says nothing about the plugin, so it is
        // reported and forgotten: it must not move the failure count in either
        // direction. Counting these quarantined a healthy Spotify connection
        // after three clicks on playlists the account does not own, which is
        // an entirely ordinary thing for someone to do.
        if (isResourceScopedCode(pluginError.code)) {
            this.pluginLog.for(pluginId).info('plugin refused a resource', { op, code: pluginError.code, error: message });
            return this.asPluginError(pluginId, op, pluginError, message, error);
        }

        const failures = (this.consecutiveFailures.get(pluginId) ?? 0) + 1;
        this.consecutiveFailures.set(pluginId, failures);

        // A non-retryable failure will not become a success on attempt two, so
        // waiting for the count is two round trips spent proving what the
        // plugin already told us. Nothing is stranded by tripping early:
        // `reset` runs on every reinit, which is what a config or credential
        // fix triggers anyway.
        const quarantine = failures >= PLUGIN_FAILURE_THRESHOLD || !pluginError.retryable;

        if (quarantine) {
            this.openBreakers.set(pluginId, reason);
            this.pluginRegistry.setStatus(pluginId, 'failed', reason);
            this.pluginLog.for(pluginId).error('plugin quarantined', { op, failures, error: message });
        } else {
            // Keep the current status (the plugin may still recover) but surface
            // the last error, so the settings UI can show what just went wrong.
            const record = this.pluginRegistry.get(pluginId);
            if (record) this.pluginRegistry.setStatus(pluginId, record.status, reason);
            this.pluginLog.for(pluginId).warn('plugin call failed', { op, failures, error: message });
        }

        return this.asPluginError(pluginId, op, pluginError, message, error);
    }

    /**
     * The outward-facing error, with the plugin and operation named in the
     * message.
     *
     * The classification is copied across rather than re-derived: this wrapper
     * exists to name who failed, not to have an opinion about what the failure
     * was. The optional detail is only applied when the plugin actually
     * supplied it, because `withRetry` also asserts the failure is retryable
     * and an absent `Retry-After` is not that assertion.
     */
    private asPluginError(pluginId: string, op: string, pluginError: PluginError, message: string, cause: unknown): PluginError {
        const wrapped = new PluginError(`plugin ${pluginId} failed during ${op}: ${message}`, { cause }).withCode(pluginError.code);

        if (pluginError.retryAfterMs !== undefined) wrapped.withRetry(pluginError.retryAfterMs);
        if (pluginError.upstreamStatus !== undefined) wrapped.withUpstreamStatus(pluginError.upstreamStatus);

        return wrapped;
    }
}
