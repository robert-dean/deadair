import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { IcecastStatsClient } from './icecast.stats.client.js';
import type { StreamConfigRender } from './stream.config.js';

/**
 * Whether the stream containers are running the config the app has rendered, or
 * an older one.
 *
 * **Why this exists.** `icecast.xml` and `radio.env` are read ONCE, at container
 * startup. Nothing re-reads them, nothing is signalled when they are re-rendered,
 * and both files carry secrets. So a schema rebuild that regenerates the five
 * `stream.*` secrets leaves two processes holding credentials that no longer
 * match anything, and the symptoms name something else entirely: Icecast refuses
 * every listener with its own "You need to authenticate" page (the
 * `listener_add` hook presents a bridge secret the app has replaced), and
 * Liquidsoap's source connection is refused, so there is no mount at all and
 * Icecast answers 404. Neither of those log lines mentions config. This turns
 * both into one sentence that does.
 *
 * **Why it reports rather than fixes.** The app runs as a sibling container with
 * no Docker socket and no business having one: a process that can restart the
 * thing broadcasting it can also take the station off air on the strength of a
 * misread, and the misread here would be a clock. Restarting Icecast drops every
 * connected listener, and restarting Liquidsoap cuts what is on air mid-track —
 * both are decisions with an audience on the other end, so they belong to the
 * operator. What the app owes them is the diagnosis and the exact command, at
 * the moment the state begins, which is what this does. Mounting the socket to
 * automate it is not deferred work; it is the wrong trade.
 *
 * **How each half is known.** They are different problems and get different
 * evidence:
 *
 * - Liquidsoap sources `radio.env`, so it can be ASKED. The file carries a
 *   `CONFIG_STAMP` over its own content, `radio.liq` reports it on every
 *   `/control/*` reading, and a stamp that differs from the rendered one is
 *   proof rather than inference. It covers the Spotify shim too, which inherits
 *   the same environment from the entrypoint.
 * - Icecast cannot be asked: it echoes nothing from its config. What it does
 *   publish is `server_start_iso8601`, so the reading is a comparison of two
 *   clocks — its start against the mtime of the rendered file. That is weaker,
 *   which is why {@link START_GRACE_MS} exists and why the wording says what was
 *   compared.
 */

/**
 * How much later than a container's start the config may have changed before the
 * container counts as stale.
 *
 * The icecast half compares two clocks. They are the same host kernel under
 * compose, so the skew is normally nothing, but a container coming up while the
 * app is rendering is an ordinary race at boot and reporting it would put a
 * false alarm in front of an operator on every cold start. Ten seconds is long
 * enough to cover that overlap and far shorter than the interval between a real
 * config change and anyone noticing.
 */
const START_GRACE_MS = 10_000;

/** How often the verdict is re-evaluated for the LOG. The console reads it fresh; see {@link warnings}. */
const CHECK_MS = 30_000;

/** Which container is holding config the app has moved on from. */
export type StaleContainer = 'icecast' | 'liquidsoap';

/**
 * One container running config the app has replaced, in the terms an operator
 * can act on.
 *
 * JSON-safe, because it is stored in nothing but is sent to the console on the
 * playout status.
 */
export interface StreamConfigWarning {
    container: StaleContainer;
    /** What is wrong and how it is known, in a sentence. */
    detail: string;
    /** The exact command that fixes it. */
    restart: string;
}

/**
 * What Liquidsoap said about itself on the last reading that arrived.
 *
 * Pushed in by {@link PlayoutControlClient} rather than fetched, because the
 * reconcile loop is already making that call twice a second and a second client
 * asking the same question would be a second answer to disagree with.
 */
export interface LiquidsoapReading {
    /**
     * `CONFIG_STAMP` as the running script reports it, or `undefined` from a
     * `radio.liq` too old to report one.
     *
     * Absent is NOT a mismatch. The app deploys independently of the container,
     * so a script that predates the stamp is an ordinary state, and the fallback
     * for it is {@link StreamConfigWatch.evaluate}'s second test.
     */
    stamp?: string;
    /** Whether Liquidsoap believes deadair's lease is live, so it is feeding the mount. */
    driving: boolean;
}

/** The command that adopts a new config, which is the only thing that does. */
const restartCommand = (service: StaleContainer): string => `docker compose restart ${service}`;

@Injectable()
export class StreamConfigWatch {
    /** What the last render put on the volume. Nothing to compare against until there is one. */
    private render?: StreamConfigRender;
    /** The last reading Liquidsoap answered. `undefined` means it has not answered, not that it is fine. */
    private liquidsoap?: LiquidsoapReading;
    /** The warnings already said out loud, keyed as one string, so a 30s loop cannot fill the log. */
    private announced = '';
    private timer?: NodeJS.Timeout;

    constructor(
        private readonly stats: IcecastStatsClient,
        private readonly logger: Logger,
    ) {}

    /**
     * Begin checking. Idempotent.
     *
     * A timer of its own rather than a hook into the audience poll or the
     * reconcile: both of those are on the path that keeps the station on air, and
     * this is a diagnostic that must never be able to slow one down. Every input
     * it reads is already cached by something else, so a pass costs no I/O.
     */
    start(): void {
        if (this.timer) return;

        this.timer = setInterval(() => this.report(), CHECK_MS);
        this.timer.unref?.();
    }

    /** Stop checking. The last render is kept; nothing is re-evaluated against it. */
    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }

    /**
     * Take the facts of a fresh render.
     *
     * `undefined` for a render that was skipped, which clears nothing: whatever
     * was on the volume before is still what the containers will read, and the
     * previous render described it correctly.
     */
    noteRender(render: StreamConfigRender | undefined): void {
        if (!render) return;

        this.render = render;
        // Said at once rather than at the next tick. A render is the moment the drift
        // BEGINS, and the operator who just changed a stream setting is the one person
        // guaranteed to be reading the log.
        this.report();
    }

    /**
     * Take what Liquidsoap said, or `undefined` when it did not answer.
     *
     * Cleared on a failed call for the same reason the icecast reading is: every
     * conclusion here is an accusation, and a stream that is merely unreachable
     * has not been accused of anything.
     */
    noteLiquidsoap(reading: LiquidsoapReading | undefined): void {
        this.liquidsoap = reading;
    }

    /**
     * The containers running config the app has replaced, or an empty list.
     *
     * Evaluated on the spot rather than served from the timer's last pass: it is
     * a comparison of cached numbers, the console polls this every couple of
     * seconds, and a verdict up to 30 seconds behind the restart that fixed it
     * would leave a red banner over a station that is working.
     */
    warnings(): StreamConfigWarning[] {
        return this.evaluate();
    }

    /** One pass, plus the log line when the verdict has changed. */
    private report(): void {
        const warnings = this.evaluate();
        const key = warnings.map(warning => `${warning.container}:${warning.detail}`).join('|');
        if (key === this.announced) return;

        // The recovery edge is worth a line of its own: an operator who ran the restart
        // should be told it worked by the thing that told them to run it.
        if (warnings.length === 0) this.logger.info('stream: both stream containers are running the current config');
        for (const warning of warnings) {
            this.logger.warn(`stream: ${warning.detail} Run: ${warning.restart}`);
        }
        this.announced = key;
    }

    /**
     * The verdict, from cached readings only.
     *
     * Silent about anything it has no evidence for. Nothing rendered yet, an
     * Icecast that is not answering, a Liquidsoap that has not been reached: all
     * of those are "unknown", and unknown is not reported, because the whole
     * value of this warning is that it has never been wrong when an operator saw
     * it.
     */
    private evaluate(): StreamConfigWarning[] {
        if (!this.render) return [];

        const warnings: StreamConfigWarning[] = [];
        const icecast = this.icecastWarning();
        if (icecast) warnings.push(icecast);
        const liquidsoap = this.liquidsoapWarning();
        if (liquidsoap) warnings.push(liquidsoap);
        return warnings;
    }

    /** Icecast started before its config last changed, so its passwords are the old ones. */
    private icecastWarning(): StreamConfigWarning | undefined {
        const server = this.stats.serverReading();
        const changedAt = this.render?.icecast.changedAt;
        if (server?.startedAt === undefined || changedAt === undefined) return undefined;
        if (changedAt <= server.startedAt + START_GRACE_MS) return undefined;

        return {
            container: 'icecast',
            detail:
                `icecast started at ${iso(server.startedAt)} and ${this.render?.icecast.path} last changed at ${iso(changedAt)}, ` +
                'so it is running the passwords that were current before then. It reads its config once, at startup, ' +
                'and until it is restarted every listener is refused on the listener_add hook and the admin stats read may be too.',
            restart: restartCommand('icecast'),
        };
    }

    /**
     * Liquidsoap is on a different `radio.env` than the one rendered, or is
     * behaving exactly as a refused source password looks.
     *
     * The stamp is checked first because it is proof and it names the cause. The
     * second test is for a script too old to carry one, where the only visible
     * symptom is the shape of the failure: Liquidsoap is up, it believes it is
     * driving, and Icecast has no source on the mount. Nothing deadair does can
     * produce that state on its own — the source connection is refused or the
     * address is wrong, and a stale `ICECAST_SOURCE_PASSWORD` is by far the
     * likelier of the two on a station that was working yesterday.
     */
    private liquidsoapWarning(): StreamConfigWarning | undefined {
        const reading = this.liquidsoap;
        const radio = this.render?.radio;
        if (!reading || !radio) return undefined;

        if (reading.stamp !== undefined) {
            if (reading.stamp === radio.stamp) return undefined;

            return {
                container: 'liquidsoap',
                detail:
                    `liquidsoap booted with config generation ${reading.stamp} and ${radio.path} is now generation ${radio.stamp}, ` +
                    'so it is holding the source password, the bridge secret and the shim secret as they stood before that render. ' +
                    'It sources that file once, at startup, so nothing it does will pick the new ones up.',
                restart: restartCommand('liquidsoap'),
            };
        }

        // No stamp, so fall back to the shape of the failure. Both halves have to be
        // known: an Icecast that is not answering says nothing about its sources.
        const server = this.stats.serverReading();
        if (!reading.driving || !server || server.sourceConnected) return undefined;

        return {
            container: 'liquidsoap',
            detail:
                `liquidsoap says it is driving ${this.stats.mountPath()} but icecast has no source on that mount, ` +
                'which is what a refused source password looks like from here. The running liquidsoap does not report ' +
                'which config generation it booted with, so this is the shape of the fault rather than proof of its cause.',
            restart: restartCommand('liquidsoap'),
        };
    }
}

/** Epoch millis as the ISO-8601 string an operator can match against a container log. */
const iso = (millis: number): string => new Date(millis).toISOString();
