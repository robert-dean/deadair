import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { AudioChainRestart } from '#modules/stream/stream.restart.js';
import {
    DEFAULT_RESTART_STUCK_CHAIN,
    FRESH_WATCHDOG,
    RESTART_STUCK_CHAIN_KEY,
    judgeAudioChain,
    type ChainFacts,
    type WatchdogMemory,
    type WatchdogVerdict,
} from './audio.chain.watchdog.js';
import { PlayoutControlClient } from './liquidsoap.control.js';
import { PlayoutPusher, RECONCILE_TICK_MS } from './playout.pusher.js';

/**
 * Asks for the audio chain back when it has stopped doing its job. `audio.chain.watchdog.ts` is the
 * judgement; this is the timer, the facts and the two things a verdict does.
 *
 * Its own timer rather than a step in the transport's pass, for two reasons. The transport's pass is
 * the thing that stalls when Liquidsoap stops answering, since every call in it waits out its own
 * timeout, and a watchdog riding inside it would be as late as the fault it is watching for. And it
 * reads nothing the pass does not already leave behind: the control client's two clocks and its last
 * reading, and the pusher's own answer to whether the station wants the mount.
 *
 * What a restart verdict does is write the request, say so in the log, and put one line in the
 * activity feed, where "why was the station quiet at 3am" is answered. What it does NOT do is touch
 * the running order: a player that comes back empty is already a non-event to the transport, whose
 * next pass reads it and hands the running order over again. That is the same argument the config
 * watch makes for restarting on a settings change without asking anybody first.
 */
@Injectable()
export class AudioChainWatch {
    private timer?: NodeJS.Timeout;
    private memory: WatchdogMemory = FRESH_WATCHDOG;

    constructor(
        private readonly control: PlayoutControlClient,
        private readonly pusher: PlayoutPusher,
        private readonly restart: AudioChainRestart,
        private readonly activity: ActivityRecorder,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Begin watching. Idempotent. */
    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.check(), RECONCILE_TICK_MS);
        this.timer.unref?.();
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }

    /**
     * Take one look and act on it. The timer's only call, and public so a test can drive it with a
     * clock of its own.
     */
    check(now = Date.now()): WatchdogVerdict {
        const { verdict, memory } = judgeAudioChain(this.facts(now), this.memory);
        this.memory = memory;

        if (verdict.action === 'restart') this.askForRestart(verdict);
        else if (verdict.action === 'giveUp') this.giveUp(verdict);
        return verdict;
    }

    private facts(now: number): ChainFacts {
        const downSince = this.control.downSince();
        const starvedSince = this.control.starvedSince();
        const reading = this.control.lastReading();
        return {
            now,
            enabled: settingIsOn(this.config, RESTART_STUCK_CHAIN_KEY, DEFAULT_RESTART_STUCK_CHAIN),
            wantsAir: this.pusher.wantsAir(),
            ...(downSince === undefined ? {} : { downForMs: now - downSince }),
            ...(starvedSince === undefined ? {} : { starvedForMs: now - starvedSince }),
            ...(reading?.ready === undefined ? {} : { ready: reading.ready }),
            ...(reading === undefined ? {} : { queued: reading.queued }),
        };
    }

    private askForRestart(verdict: Extract<WatchdogVerdict, { action: 'restart' }>): void {
        const written = this.restart.request(verdict.reason);
        this.logger.warn(`playout: ${verdict.detail}`, { reason: verdict.reason, stuckForMs: verdict.stuckForMs, written });
        void this.activity.record({
            module: 'playout',
            kind: 'chain.restart',
            severity: 'fault',
            // A request that could not be written is still worth the line, and worth saying so: the
            // chain is stuck either way, and the operator is the one who now has to restart it.
            detail: written ? verdict.detail : `${verdict.detail} The request could not be written, so it has to be restarted by hand.`,
            data: { reason: verdict.reason, stuckForMs: verdict.stuckForMs, written },
        });
    }

    private giveUp(verdict: Extract<WatchdogVerdict, { action: 'giveUp' }>): void {
        this.logger.error(`playout: ${verdict.detail}`, { reason: verdict.reason, stuckForMs: verdict.stuckForMs });
        void this.activity.record({
            module: 'playout',
            kind: 'chain.gaveUp',
            severity: 'fault',
            detail: verdict.detail,
            data: { reason: verdict.reason, stuckForMs: verdict.stuckForMs },
        });
    }
}
