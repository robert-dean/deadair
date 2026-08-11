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
 * no Docker socket and no business having one: that is root on the host, traded
 * for a process being able to restart the thing broadcasting it. The restart
 * authority belongs inside the container that needs restarting, which is where
 * it now is — `stream/config-watch.sh` polls each rendered file's mtime and stops
 * its own container when it moves, and the compose restart policy brings it back
 * on the new config. No socket anywhere, and nothing can restart anything but
 * itself.
 *
 * That makes this the SECOND line, and it changes what a warning means. The
 * ordinary path is now silent: the file changes, the container notices within a
 * few seconds and comes back adopted, and nobody is told about a fault that
 * lasted ten seconds and fixed itself. So nothing is reported until the state has
 * survived {@link DRIFT_GRACE_MS}, by which point the self-restart has demonstrably
 * not happened — the watch is off, the image predates it, the restart policy was
 * changed, or the container is failing to come back. That is exactly when a
 * person is needed, and it is what the command in the warning is for.
 *
 * The warning names the elapsed FACT rather than an expectation, and that is
 * worth keeping. An earlier draft said the container's own watch "should have
 * restarted it and has not", and it was measured firing against containers that
 * had no watch at all — sending the reader hunting for a broken watcher that did
 * not exist. It reads the same way to anyone who set `CONFIG_WATCH_INTERVAL_S=0`
 * deliberately. This is only worth anything while it has never misdescribed what
 * it found.
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

/**
 * How long a container has to stay behind before anybody is told.
 *
 * The containers watch their own config and restart themselves, so the ordinary
 * case is over in about ten seconds and warning about it would train an operator
 * to ignore this. Forty-five seconds is comfortably past `config-watch.sh`'s
 * worst case (one poll interval to see the change, one more to confirm it
 * settled, then a container start), so anything still standing here is a
 * self-restart that did not happen rather than one still in progress.
 */
const DRIFT_GRACE_MS = 45_000;

/** How often the verdict is re-evaluated for the LOG. The console reads it fresh; see {@link warnings}. */
const CHECK_MS = 10_000;

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
    /** When each container was first seen to be behind, so {@link DRIFT_GRACE_MS} can be applied. */
    private readonly firstSeen = new Map<StaleContainer, number>();
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
        // Evaluated at once rather than at the next tick, which now starts the grace clock
        // rather than saying anything: a render is the moment the drift begins, and the
        // container's own watch is about to end it.
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
        // Start the grace clock from the reading rather than from whenever something
        // next thinks to look, so the window measures how long the container has
        // actually been behind and not how long ago anybody asked. The reconcile loop
        // calls this twice a second and the work is a map lookup.
        this.settled();
    }

    /**
     * The containers running config the app has replaced for long enough that
     * they were not going to fix it themselves, or an empty list.
     *
     * Evaluated on the spot rather than served from the timer's last pass: it is
     * a comparison of cached numbers, the console polls this every couple of
     * seconds, and a verdict ten seconds behind the restart that fixed it would
     * leave a red banner over a station that is working.
     */
    warnings(): StreamConfigWarning[] {
        return this.settled();
    }

    /**
     * {@link evaluate}, with anything too young to have outlived the container's
     * own restart held back.
     *
     * Bookkeeping inside what is otherwise a read, which is worth the smell: the
     * observation is idempotent, and the alternative is a verdict whose age
     * depends on which caller happened to look. A container that drops off the
     * list has its clock forgotten, so a fault that recurs is a fresh one and
     * gets the full grace again rather than firing instantly on a stale mark.
     */
    private settled(): StreamConfigWarning[] {
        const now = Date.now();
        const candidates = this.evaluate();

        for (const container of this.firstSeen.keys()) {
            if (!candidates.some(candidate => candidate.container === container)) this.firstSeen.delete(container);
        }

        return candidates.filter(candidate => {
            const since = this.firstSeen.get(candidate.container) ?? now;
            this.firstSeen.set(candidate.container, since);
            return now - since >= DRIFT_GRACE_MS;
        });
    }

    /** One pass, plus the log line when the verdict has changed. */
    private report(): void {
        const warnings = this.settled();
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
                'so it is running the passwords that were current before then, and every listener is being refused on the ' +
                'listener_add hook. It reads its config once, at startup, and it has now been behind for longer than a ' +
                'container watching its own config takes to restart, so that watch is off or it is not working here.',
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
                    'It sources that file once, at startup, and it has now been behind for longer than a container watching its ' +
                    'own config takes to restart, so that watch is off or it is not working here.',
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
