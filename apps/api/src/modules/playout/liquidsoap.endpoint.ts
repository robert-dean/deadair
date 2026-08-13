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

/** The harbor port the control endpoints share with the `dj` mount. */
const DEFAULT_HARBOR_PORT = '8005';

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
    async resolve(): Promise<string | undefined> {
        const current = this.current();
        if (current) return current;

        this.probing ??= this.probe().finally(() => {
            this.probing = undefined;
        });
        return this.probing;
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
            const answers = await Promise.all(candidates.map(candidate => reachable(candidate, this.bridgeSecret)));
            const found = candidates.find((_, index) => answers[index]);

            if (found !== undefined) {
                this.resolved = found;
                this.reportedMissing = false;
                this.logger.info(`liquidsoap: playout control found at ${found}`);
                return found;
            }
        }

        if (!this.reportedMissing) {
            this.reportedMissing = true;
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

/** True when the control API answers at this base URL. Pure I/O; exported for tests. */
export async function reachable(base: string, secret: string): Promise<boolean> {
    try {
        const response = await fetch(`${base}/control/status`, {
            headers: { 'X-Playout-Secret': secret },
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        return response.ok;
    } catch {
        // Unresolvable host (the compose name off-network), connection refused, or timeout.
        return false;
    }
}
