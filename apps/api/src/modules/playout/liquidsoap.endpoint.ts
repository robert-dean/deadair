import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';

/**
 * Where Liquidsoap's playout control API lives, and the secret it is gated on.
 *
 * Nothing about the address is per-install: there are exactly two ways to reach
 * the container, by compose service name from inside the network or on the
 * host-published loopback port. So both are probed and whichever answers is
 * kept, rather than making the operator configure it for a host-run app.
 *
 * Reachability is therefore also the enable signal. With no stream up nothing
 * answers and the pusher stays quiet; a stack started later is picked up on the
 * next probe with no app restart.
 */

/**
 * How long a candidate has to answer the probe.
 *
 * It used to be 500ms, on the assumption that "a live one answers in milliseconds". Measured
 * against the real container while it played nothing, the harbor's p90 is 739ms and its peak is
 * 1.64s — so **7.5% of probes against a perfectly healthy stream failed** (3 of 40), and every one
 * of those left the app believing nothing was there to air through.
 *
 * Two seconds is past the measured peak with room for the load the idle measurement did not have.
 * It costs a slow first boot against a stream that genuinely is not up, which happens once.
 */
const PROBE_TIMEOUT_MS = 2000;

/**
 * The least time between two rounds of probing.
 *
 * There was none, and the probe is reached from {@link resolve}, which every call makes — so a
 * failing probe was retried as fast as whatever was calling. Measured against the real container:
 * one app process that could not authenticate sent **20 requests a second, indefinitely**, which
 * saturated the harbor, pushed a healthy process's calls past their timeout, and took the station
 * off air by starving the lease. The engine cannot answer a probe while it is busy being probed.
 *
 * One reconcile tick, so a probe costs no more than the loop that drives it would have, and a
 * stream coming up is still found within a couple of seconds. It bounds ONE instance; the flood
 * above was many, which is the other half of that story and belongs to whatever leaked them.
 */
const PROBE_BACKOFF_MS = 2000;

/** The harbor port the control endpoints share with the `dj` mount. */
const DEFAULT_HARBOR_PORT = '8005';

/**
 * What a candidate said when asked.
 *
 * `denied` is the one that has to be its own answer. A 401 and a refused connection were both
 * `false` for as long as this existed, so a secret that did not match reported as a stream that was
 * not up: the console said `streamUnreachable`, the operator went looking for a container that was
 * running perfectly well, and the app retried forever because there is nothing to wait for when the
 * fault is a credential. They are opposite facts — one means nothing is there, the other means
 * something is there and refusing us — and only the second one names its own fix.
 */
export type ProbeOutcome = 'ok' | 'denied' | 'silent';

/** Candidates in preference order: the compose service, then the host-published port. */
export function controlCandidates(port: string): string[] {
    return [`http://liquidsoap:${port}`, `http://127.0.0.1:${port}`];
}

@Injectable()
export class LiquidsoapEndpoint {
    /** The base URL that last answered, without a trailing slash. */
    private resolved?: string;
    /** In-flight probe, so concurrent callers share one round of requests. */
    private probing?: Promise<string | undefined>;
    /** Whether "not found" has already been said, so the reconcile loop cannot fill the log. */
    private reportedMissing = false;
    /** Whether the rejected secret has already been said, for the same reason. */
    private reportedDenied = false;
    /**
     * Since when a candidate has been answering, and refusing the secret.
     *
     * `undefined` the moment any probe succeeds. Held rather than derived because the fault is
     * invisible everywhere else: every call simply fails, exactly as it would against a stream that
     * is not there. See {@link ProbeOutcome}.
     */
    private deniedSince?: number;
    /** When the last round of probing finished, so a failing probe cannot become a flood. */
    private probedAt?: number;
    /** The bridge secret, pushed in at boot. See {@link useSecret}. */
    private bridgeSecret = '';

    constructor(
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Install the bridge secret.
     *
     * Pushed in rather than read on demand because it lives in the database
     * behind a scoped repository, and this is a singleton that the reconcile loop
     * hits every couple of seconds. `PlayoutModule.ready` reads it once, in a
     * scope of its own, after `StreamModule.ready` has seeded and materialized
     * it — the same value that reached `radio.env`, so the two ends of the bridge
     * cannot disagree.
     */
    useSecret(secret: string): void {
        this.bridgeSecret = secret;
    }

    /** The shared secret both directions of the playout bridge are gated on. */
    secret(): string {
        return this.bridgeSecret;
    }

    /** The endpoint resolved so far, or `undefined` when nothing has answered. */
    current(): string | undefined {
        return this.override() ?? this.resolved;
    }

    /**
     * The configured override, else the first candidate whose `/control/status`
     * answers. Cached, and coalesced across concurrent callers. Resolves to
     * `undefined` when the stream is not up.
     */
    async resolve(now = Date.now()): Promise<string | undefined> {
        const current = this.current();
        if (current) return current;

        // Backed off BEFORE the coalescing rather than inside the probe, so a caller that arrives
        // during the window is answered from here and never queues behind a round it is too early
        // to want. See {@link PROBE_BACKOFF_MS} for what that cost when it was missing.
        if (this.probing === undefined && this.probedAt !== undefined && now - this.probedAt < PROBE_BACKOFF_MS) return undefined;

        this.probing ??= this.probe().finally(() => {
            this.probedAt = Date.now();
            this.probing = undefined;
        });
        return this.probing;
    }

    /**
     * Since when the control API has been answering and refusing our secret, if it is.
     *
     * The one fault here that is neither "up" nor "down", and the reason it is published: nothing
     * else in the app can tell a wrong secret from a stopped container, because both make every
     * call fail. `silence.diagnosis.ts` names it so an operator is sent at the credential rather
     * than at the stream.
     */
    deniedSinceMs(): number | undefined {
        return this.deniedSince;
    }

    /**
     * Forget the resolved endpoint so the next {@link resolve} probes again.
     * Called when a request fails: the stream may have restarted or moved. A
     * configured override is not forgotten, because it is not a guess.
     */
    invalidate(): void {
        this.resolved = undefined;
    }

    private async probe(): Promise<string | undefined> {
        const candidates = controlCandidates(this.config.get('STREAM_HARBOR_PORT', DEFAULT_HARBOR_PORT));

        // With no secret every candidate answers 401, so a probe could only mislead.
        if (this.bridgeSecret) {
            // CONCURRENTLY, and that is the fix for an ordering that cannot be right in both
            // places. `liquidsoap:8005` is the only address that works in compose and does not
            // resolve at all from a host `pnpm dev`; `127.0.0.1:8005` is the exact opposite. Tried
            // in sequence, every probe in one of the two environments spends its whole budget on a
            // name that was never going to answer before reaching the one that does — and the app
            // re-probes after any failed call, so that cost is paid over and over.
            //
            // Asked together, a probe costs ONE timeout rather than the sum of them, and neither
            // environment is the penalised one. The preference below is still the declared order
            // rather than whoever answers first: they are asked at once, and if both somehow
            // answer, the first candidate wins the way it always did.
            const answers = await Promise.all(candidates.map(candidate => probeOne(candidate, this.bridgeSecret)));
            const found = candidates.find((_, index) => answers[index] === 'ok');

            if (found !== undefined) {
                this.resolved = found;
                this.reportedMissing = false;
                this.reportedDenied = false;
                this.deniedSince = undefined;
                this.logger.info(`liquidsoap: playout control found at ${found}`);
                return found;
            }

            // Something is there. Reported as its own fault rather than as a stream that is not up,
            // because it is the only one of the two an operator can act on, and because the action
            // is specific: the value in `radio.env` is what the running container holds, and it is
            // adopted by restarting that container rather than by anything the app can do.
            const denied = candidates.find((_, index) => answers[index] === 'denied');
            if (denied !== undefined) {
                this.deniedSince ??= Date.now();
                if (!this.reportedDenied) {
                    this.reportedDenied = true;
                    this.reportedMissing = false;
                    this.logger.warn(
                        `liquidsoap: playout control at ${denied} is refusing this app's bridge secret — ` +
                            'nothing can be handed over until PLAYOUT_BRIDGE_SECRET in the rendered radio.env matches the stored ' +
                            'setting, which takes a liquidsoap restart to adopt',
                    );
                }
                return undefined;
            }
        }

        this.deniedSince = undefined;
        if (!this.reportedMissing) {
            this.reportedMissing = true;
            this.reportedDenied = false;
            this.logger.info(`liquidsoap: no playout control on ${candidates.join(' or ')} — nothing will air until the stream is up`);
        }
        return undefined;
    }

    /** `LIQUIDSOAP_CONTROL_URL`, normalised. `undefined` when unset. */
    private override(): string | undefined {
        const raw = this.config.get('LIQUIDSOAP_CONTROL_URL', '');
        return raw ? raw.replace(/\/+$/, '') : undefined;
    }
}

/**
 * Ask one base URL what it is. Pure I/O; exported for tests.
 *
 * A 401 is `denied` rather than `silent` because `control_authorized` in `radio.liq` is the only
 * thing that answers one, so it is proof of a live engine on the other end. Every other status is
 * `silent`: this is a probe, and a control API answering 500 is not one we can drive.
 */
export async function probeOne(base: string, secret: string): Promise<ProbeOutcome> {
    try {
        const response = await fetch(`${base}/control/status`, {
            headers: { 'X-Playout-Secret': secret },
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (response.ok) return 'ok';
        return response.status === 401 ? 'denied' : 'silent';
    } catch {
        // Unresolvable host (the compose name off-network), connection refused, or timeout.
        return 'silent';
    }
}
