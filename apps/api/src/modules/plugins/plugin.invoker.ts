import { Injectable } from 'injectkit';
import { PluginError, isResourceScopedCode, toPluginError, type PluginConnectionResult } from '@deadair/plugin-sdk';
import { runWithDeadline } from './plugin.invocation.deadline.js';
import { PluginLog } from './plugin.log.js';
import { PluginRegistry } from './plugin.registry.js';
import { serverkitErrorText } from '#modules/shared/error.text.js';
import { recordSpan, spanError } from '#modules/shared/trace.spans.js';

/**
 * How long a single call into plugin code may run before it is abandoned.
 *
 * Under `DATABASE_POOL_CONNECTION_TIMEOUT_MS` (10s in `data.module.ts`), and that ordering is the
 * whole of the figure. A plugin call on the request path (`testConnection`, the OAuth pair, a
 * catalog page, a search) runs inside the request's transaction, so it holds one of
 * `DATABASE_POOL_MAX` connections for exactly as long as it lasts. At 15s it outlived the patience
 * of everything queued behind it: a request waiting for a connection gave up at 10s while the call
 * holding the connection still had five seconds of its own budget to spend. Whichever of the two
 * numbers moves, they have to keep this order, or the pool starts shedding requests to protect
 * itself from a call the host had already decided was acceptable.
 *
 * Only the default, and only for calls that ask for nothing. Everything that genuinely needs longer
 * says so per call and is off the request path when it does: `speech.speak`, `llm.generate`,
 * `analysis.analyzeTrack`, `mixer.join`, the enrichment walk.
 */
export const PLUGIN_INVOKE_TIMEOUT_MS = 8_000;

/** Consecutive failures that trip the breaker and quarantine the plugin. */
export const PLUGIN_FAILURE_THRESHOLD = 3;

/**
 * How long a quarantined plugin waits before the host asks it again on its own. Doubles after every
 * automatic probe that finds it still down, up to {@link PLUGIN_RECOVERY_MAX_MS}.
 *
 * A minute because the failure this is for is an upstream having a bad few minutes: Spotify
 * answering 502 to three searches in a row. Sooner, and the probe lands in the same outage that
 * tripped the breaker; much later, and a station that could have been playing from its main provider
 * again spends the time on its fallbacks.
 */
export const PLUGIN_RECOVERY_FIRST_MS = 60_000;

/**
 * The longest gap between automatic probes, however long the plugin has been down. A long outage
 * costs one `testConnection` per half hour, which no provider will notice, and a plugin that comes
 * back after one is back within the half hour rather than whenever somebody looks.
 */
export const PLUGIN_RECOVERY_MAX_MS = 30 * 60_000;

/** The op an automatic probe runs, and the one the Test connection route runs through `probe`. */
export const PROBE_OP = 'testConnection';

/**
 * The one op the breaker never refuses. Named here rather than at the lifecycle manager's call
 * site so the two cannot drift: the manager passes this constant, and `invoke` compares against it.
 */
export const DISPOSE_OP = 'dispose';

export interface PluginInvokeOptions {
    /** Overrides {@link PLUGIN_INVOKE_TIMEOUT_MS} for one call. */
    timeoutMs?: number;
}

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
 * something (a config change, a reinit) calls {@link PluginInvoker.reset}, or
 * a {@link PluginInvoker.probe} comes back healthy.
 *
 * The breaker runs those probes itself when the failure that tripped it was
 * one retrying can end, on a backoff from {@link PLUGIN_RECOVERY_FIRST_MS} to
 * {@link PLUGIN_RECOVERY_MAX_MS}. It has to: every capability accessor skips a
 * plugin whose status is not `active`, so no call ever arrives at a quarantined
 * plugin for the textbook half-open breaker to let through. A quarantine the
 * plugin declared permanent (`auth`, `config`) is not probed, because the
 * plugin has already said the answer will not change; the operator's Test
 * connection still asks it.
 *
 * A passing probe lifts the quarantine but not the backoff. An engine that
 * lists voices but cannot speak passes `testConnection` every time and fails
 * every real call, and forgiving the count on that probe alone is what had it
 * quarantined and reopened every single minute. The count only resets once
 * {@link PluginInvoker.recordSuccess} has seen {@link PLUGIN_RECOVERY_FIRST_MS}
 * pass with nothing failing, which is the plugin actually working rather than
 * merely answering one question.
 *
 * The timers are in this process because the breaker is: a pg-boss cron would
 * be claimed by whichever worker got there first, which is not necessarily the
 * one holding the open breaker.
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

    /** The pending automatic probe per quarantined plugin. At most one each. */
    private readonly recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();

    /**
     * Automatic probes scheduled since the breaker opened, which is what the backoff doubles on.
     * Present exactly while the quarantine in force is one the breaker will probe its way out of, OR
     * the plugin has passed a probe too recently for {@link recordSuccess} to have forgiven it yet.
     */
    private readonly recoveryAttempts = new Map<string, number>();

    /**
     * When this plugin last failed a call, the clock {@link recoveryAttempts} decays against.
     * {@link recordSuccess} only forgives the backoff once this is more than
     * {@link PLUGIN_RECOVERY_FIRST_MS} in the past, so a probe passing the moment the quarantine
     * lifts does not, by itself, read as proof the trouble is over.
     */
    private readonly lastFailureAt = new Map<string, number>();

    /** Set by {@link PluginInvoker.stopRecovery}, so nothing torn down later schedules another probe. */
    private recoveryStopped = false;

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
        // `dispose` goes through whatever the breaker says. The breaker exists to stop spending
        // calls on a plugin that cannot answer; letting go of one is not a call that can be spent,
        // and refusing it is how a quarantined plugin's timers and open bodies outlived every reinit:
        // the lifecycle manager disposes BEFORE it resets, so the plugin the breaker had tripped was
        // exactly the one whose `dispose()` never ran, and the leak was in the API process until a
        // restart. Everything else about a failing dispose is unchanged — it is timed, caught and
        // recorded like any other op.
        if (openReason !== undefined && op !== DISPOSE_OP) {
            throw new PluginError(`plugin ${pluginId} is failed: ${openReason}`).withCode('unavailable');
        }

        const result = await this.run(pluginId, op, fn, opts);
        this.recordSuccess(pluginId);
        return result;
    }

    /**
     * Asks a plugin whether it can reach its provider, whatever the breaker says, and lets the answer
     * decide the breaker.
     *
     * This is the breaker's half-open probe, run by the Test connection route and by the breaker's
     * own recovery timer alike. Without it the button on a quarantined plugin answered with the
     * reason the breaker had stored (the director's third failed Spotify search in a row) and
     * `testConnection` never ran. The one control an operator reaches for to ask "is it
     * back?" could only repeat the old error, and the only way to un-quarantine a plugin whose
     * provider had merely had a bad few minutes was to re-save its settings.
     *
     * The verdict is the plugin's ANSWER rather than whether the call resolved, because
     * `testConnection` reports a failing connection as `{ ok: false }` and never throws: every
     * bundled plugin catches its own upstream error and says so in the message. So:
     *
     * - `ok: true` closes the breaker, and a plugin the breaker had quarantined is `active` again.
     * - `ok: false` on a quarantined plugin keeps it quarantined and replaces the stored reason, so
     *   the settings page shows what is wrong now rather than what was wrong when it tripped.
     * - `ok: false` on a healthy plugin moves nothing. It used to count as a success and clear the
     *   failure count, which is the plugin saying it cannot connect being read as evidence it can;
     *   and counting it as a failure would let three presses of a test button quarantine a plugin
     *   the station was still using.
     * - A throw or a timeout is recorded exactly as {@link PluginInvoker.invoke} records one.
     *
     * @throws {PluginError} when `fn` rejects or times out, as `invoke` does. Never for an open
     *   breaker: going through it is the point.
     */
    async probe(
        pluginId: string,
        op: string,
        fn: (signal: AbortSignal) => Promise<PluginConnectionResult>,
        opts?: PluginInvokeOptions,
    ): Promise<PluginConnectionResult> {
        const result = await this.run(pluginId, op, fn, opts);

        if (result.ok) {
            this.recover(pluginId, op);
        } else if (this.openBreakers.has(pluginId)) {
            const reason = `${op}: ${result.message ?? 'the plugin could not connect'}`;
            this.openBreakers.set(pluginId, reason);
            this.pluginRegistry.setStatus(pluginId, 'failed', reason);
            this.pluginLog.for(pluginId).warn('plugin failed its probe; still quarantined', { op, error: reason });
        }

        return result;
    }

    /**
     * The call itself, with the deadline, the failure accounting and the span, and without the
     * breaker check or the success accounting: those are what `invoke` and `probe` disagree about.
     */
    private async run<T>(pluginId: string, op: string, fn: (signal: AbortSignal) => Promise<T>, opts?: PluginInvokeOptions): Promise<T> {
        const timeoutMs = opts?.timeoutMs ?? PLUGIN_INVOKE_TIMEOUT_MS;
        const timeout = deadline(timeoutMs, `plugin ${pluginId} timed out after ${timeoutMs}ms during ${op}`);
        // Started here rather than inside the `try`, so a synchronous throw out of `deadline` would
        // still be measured from the same point everything else is.
        const startedAt = Date.now();
        let failure: unknown;

        try {
            // `fn` may throw synchronously; wrapping it keeps that on the same
            // path as a rejection instead of escaping the race entirely.
            //
            // Published as the ambient deadline and signal as well as raced
            // against, so host services the plugin calls back into can size
            // their own budgets against the time this call actually has left
            // rather than against the default constant, and so the plugin
            // itself can watch the same signal this races on rather than
            // polling a clock. See `plugin.invocation.deadline.ts`.
            const call = runWithDeadline(Date.now() + timeoutMs, timeout.signal, async () => fn(timeout.signal));
            return await Promise.race([call, timeout.expiry]);
        } catch (error) {
            failure = error;
            throw this.recordFailure(pluginId, op, error);
        } finally {
            timeout.dispose();
            // In the `finally` because that is the whole point. The calls worth costing are the ones
            // that end without saying anything — a timeout, a plugin disposed with its response body
            // still open — and both leave by this path and by no other. A span taken from the
            // RESULT would miss exactly them; see `trace.spans.ts`.
            recordSpan({
                op: 'plugin.invoke',
                target: `${pluginId} ${op}`,
                ms: Date.now() - startedAt,
                outcome: failure === undefined ? 'ok' : 'failed',
                ...(failure === undefined ? {} : { error: spanError(failure) }),
                // The bound this call was given, so a duration can be read against what it was
                // allowed rather than against a constant a reader has to go and look up.
                detail: { timeoutMs },
            });
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
        this.lastFailureAt.delete(pluginId);
        this.cancelRecovery(pluginId);
    }

    /**
     * Cancels every pending automatic probe and schedules no more. Called on shutdown BEFORE the
     * plugins are disposed, so a probe cannot start against an instance that is being let go of,
     * and a dispose that fails on the way out cannot arm a fresh one.
     */
    stopRecovery(): void {
        this.recoveryStopped = true;
        for (const pluginId of [...this.recoveryTimers.keys()]) this.cancelRecovery(pluginId);
    }

    /** Whether calls to this plugin are currently short-circuiting. */
    isBreakerOpen(pluginId: string): boolean {
        return this.openBreakers.has(pluginId);
    }

    private recordSuccess(pluginId: string): void {
        this.consecutiveFailures.delete(pluginId);

        // The backoff is not forgiven by the probe that closed the breaker (see `recover`); it is
        // forgiven here, once PLUGIN_RECOVERY_FIRST_MS of ordinary calls have gone by without one
        // failing. Before that, an engine that lists voices but cannot speak would pass its probe,
        // fail on the first real call a moment later, and be right back on a one-minute backoff,
        // which is indistinguishable from never having decayed at all.
        if (this.recoveryAttempts.has(pluginId) && Date.now() - (this.lastFailureAt.get(pluginId) ?? 0) >= PLUGIN_RECOVERY_FIRST_MS) {
            this.recoveryAttempts.delete(pluginId);
            this.lastFailureAt.delete(pluginId);
        }
    }

    /**
     * Undoes a quarantine on the evidence of a healthy probe.
     *
     * The status goes back only if it is still the `failed` the breaker wrote and the instance the
     * probe ran against is still there. A reinit can land while a probe is in flight, and one that
     * failed has already written `failed` over a record with no instance: calling that `active`
     * would advertise a plugin nothing can call.
     *
     * This closes the breaker and the pending timer, but deliberately NOT `recoveryAttempts`: unlike
     * {@link reset}, which is a config fix and gets the plugin's full forgiveness, a probe is only
     * ever evidence that `testConnection` works. `recordSuccess` is what decides the trouble is
     * actually over, once real calls have gone well for a while. What a probe closing the breaker
     * DOES mean is that the plugin can fail again starting now, so the backoff's clock is set here.
     */
    private recover(pluginId: string, op: string): void {
        const wasOpen = this.openBreakers.has(pluginId);
        this.consecutiveFailures.delete(pluginId);
        this.openBreakers.delete(pluginId);
        this.clearRecoveryTimer(pluginId);
        if (!wasOpen) return;
        this.lastFailureAt.set(pluginId, Date.now());

        const record = this.pluginRegistry.get(pluginId);
        if (record?.status === 'failed' && record.instance !== undefined) this.pluginRegistry.setStatus(pluginId, 'active');
        this.pluginLog.for(pluginId).info('plugin passed its probe; quarantine lifted', { op });
    }

    /**
     * Arms the next automatic probe, unless one is already pending: a failure arriving while one is
     * (the operator's own test, say) must not keep pushing the station's recovery further out.
     *
     * Never sooner than the upstream asked for. A 429 with `Retry-After` is the provider stating
     * when it will talk to us again, and a probe before then is a request it has said it will refuse.
     */
    private scheduleRecovery(pluginId: string, notBeforeMs?: number): void {
        if (this.recoveryStopped || this.recoveryTimers.has(pluginId)) return;

        const attempts = this.recoveryAttempts.get(pluginId) ?? 0;
        const backoff = Math.min(PLUGIN_RECOVERY_FIRST_MS * 2 ** attempts, PLUGIN_RECOVERY_MAX_MS);
        const delayMs = Math.max(backoff, notBeforeMs ?? 0);
        this.recoveryAttempts.set(pluginId, attempts + 1);

        const timer = setTimeout(() => void this.probeOnSchedule(pluginId), delayMs);
        // A probe half an hour out is not a reason for a process to stay alive.
        timer.unref();
        this.recoveryTimers.set(pluginId, timer);
        this.pluginLog.for(pluginId).info('plugin will be probed again on its own', { inMs: delayMs, attempt: attempts + 1 });
    }

    /**
     * Cancels the pending automatic probe without forgetting how many the breaker has already spent.
     * {@link recover} uses this rather than {@link cancelRecovery}: a passing probe closes the timer
     * but must not erase the count {@link recordSuccess} is still deciding whether to forgive.
     */
    private clearRecoveryTimer(pluginId: string): void {
        const timer = this.recoveryTimers.get(pluginId);
        if (timer !== undefined) clearTimeout(timer);
        this.recoveryTimers.delete(pluginId);
    }

    private cancelRecovery(pluginId: string): void {
        this.clearRecoveryTimer(pluginId);
        this.recoveryAttempts.delete(pluginId);
    }

    /**
     * The timer's half of recovery: ask the plugin, and go again later if it is still down.
     *
     * Only asks an instance that is still there. A plugin disabled or mid-reinit has none, and the
     * reinit resets the breaker anyway. One with no `testConnection` has nothing to ask and waits
     * for a reinit, which is also the only thing the Test connection button could offer it.
     *
     * Never rejects: this runs from a timer, where a rejection has no one to land on.
     */
    private async probeOnSchedule(pluginId: string): Promise<void> {
        this.recoveryTimers.delete(pluginId);
        if (this.recoveryStopped || !this.openBreakers.has(pluginId)) return;

        const instance = this.pluginRegistry.instance(pluginId);
        if (instance === undefined) return;
        if (typeof instance.testConnection !== 'function') {
            this.recoveryAttempts.delete(pluginId);
            this.pluginLog.for(pluginId).warn('plugin has no testConnection to probe; it stays quarantined until it is reinitialized');
            return;
        }

        try {
            await this.probe(pluginId, PROBE_OP, async () => instance.testConnection!());
        } catch {
            // Recorded by `run`, and a retryable throw has already armed the next probe from there.
        }

        // `ok: false` arms nothing on its own path (the operator's test shares it), so the timer's
        // half re-arms here. Still open and still a quarantine retrying can end: go again, later.
        if (this.openBreakers.has(pluginId) && this.recoveryAttempts.has(pluginId)) this.scheduleRecovery(pluginId);
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
     * `serverkitErrorText` either way.
     */
    private recordFailure(pluginId: string, op: string, error: unknown): PluginError {
        const pluginError = toPluginError(error);
        const message = serverkitErrorText(error);
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

        // The clock `recordSuccess` decays the backoff against. Set for every real failure, not only
        // the ones that quarantine, so a plugin that fails occasionally without ever tripping the
        // breaker still resets its own recovery clock rather than accumulating decay it did nothing
        // to earn.
        this.lastFailureAt.set(pluginId, Date.now());

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
            // The latest failure decides, including one from a probe: a plugin that was merely
            // unreachable and now answers `auth` has told us the answer will not change.
            if (pluginError.retryable) this.scheduleRecovery(pluginId, pluginError.retryAfterMs);
            else this.cancelRecovery(pluginId);
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
