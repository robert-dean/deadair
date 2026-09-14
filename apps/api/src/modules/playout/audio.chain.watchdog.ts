/**
 * Whether the audio chain has stopped doing its job, and whether to ask for it back.
 *
 * ## What happened, which is why this exists
 *
 * On 2026-09-13 a listener arrived at 17:12:45, the transport handed Liquidsoap a record, and
 * Liquidsoap wrote its last log line for ten minutes: it never prepared the record and never
 * switched to the programme. Its control API went on answering most calls, so nothing reported it
 * as down. What the station saw was `starved` (its local bed on the mount while deadair held the
 * lease) for as long as anybody was listening. Every console action went to a process that was no
 * longer acting on them, and only a restart by hand brought it back, after which the SAME record
 * played within six seconds.
 *
 * So there are two signatures, and a probe of the control API catches only one:
 *
 * - **Holding a record and not playing it** (`holdingNotPlaying`). Liquidsoap says, through its own
 *   starve push and its own reading, that its queue is not producing, while that same reading says
 *   it is holding at least one request. The holding half is what makes this a fault in the player
 *   rather than in the app: a starve with nothing queued is the transport having nothing to hand
 *   over, and restarting the player for that fixes nothing and cuts nothing but the bed.
 * - **Not answering at all** (`notAnswering`). The control API has failed every call for a minute.
 *   The supervisor already restarts a Liquidsoap that EXITS within a second or two, so a minute of
 *   silence from a process still running is a hung one. Judged whether or not anybody is listening,
 *   because a restart that nobody hears is the cheapest one there is, and a chain that hung in the
 *   small hours should not wait for the first listener of the morning to be found.
 *
 * ## What it deliberately is not
 *
 * Not a health check and not a diagnosis: `silence.diagnosis.ts` says why the station is quiet,
 * and this only says whether one specific thing is worth doing about one of those reasons. It is
 * pure over a snapshot for the reason that file is: every fact lives on a singleton with a timer
 * behind it, and the thresholds and the bounds are exactly the part worth testing.
 *
 * And bounded, twice over, because a restart that does not help must not become a loop that cuts
 * the air every minute for ever. One request per {@link RESTART_COOLDOWN_MS}, and after
 * {@link RESTART_ATTEMPTS} requests with no sign of the chain working in between, one last verdict
 * saying so and then nothing until it recovers by some other means.
 */

/**
 * The operator's switch, read through `settingIsOn` because a setting is a string.
 *
 * On by default, because what it replaces is a station on its bed until somebody notices. Off is for
 * an operator who would rather keep a stuck chain stuck and look at it, and it sits beside the
 * container's own `CONFIG_WATCH_INTERVAL_S=0`, which stops the request being acted on at all.
 */
export const RESTART_STUCK_CHAIN_KEY = 'playout.restartStuckChain';
export const DEFAULT_RESTART_STUCK_CHAIN = true;

/** How long a chain may hold a record without playing it before it is judged stuck. */
export const STUCK_AFTER_MS = 60_000;

/**
 * How long the control API may fail every call before a running Liquidsoap is judged hung.
 *
 * Measured against the live station's own log: from 2026-09-04 to 2026-09-14 the control API failed
 * 62 status calls and 15 lease renewals, in bursts of up to about twelve seconds, and every one of
 * them recovered on its own. A minute is several times the worst of those.
 */
export const UNREACHABLE_AFTER_MS = 60_000;

/**
 * The least time between two restart requests.
 *
 * Longer than anything a request takes to land: the watch polls every five seconds and waits one
 * poll for the file to settle, and the supervisor allows ten seconds for a stop before it kills.
 */
export const RESTART_COOLDOWN_MS = 300_000;

/** How many restarts may be asked for, with no sign of the chain working in between, before giving up. */
export const RESTART_ATTEMPTS = 3;

/** Which of the two signatures the chain is showing. */
export type StuckReason = 'holdingNotPlaying' | 'notAnswering';

/** One reading of the audio chain, as plain values so the judgement can be called with a literal. */
export interface ChainFacts {
    /** Now, passed in so the thresholds can be tested without faking a clock. */
    now: number;
    /** Whether the operator has left the watchdog switched on. */
    enabled: boolean;
    /** Whether deadair wants the mount at this instant: a programme to air, and somebody to hear it. */
    wantsAir: boolean;
    /**
     * How long the control API has been failing to answer at all. `undefined` while it answers, or
     * before anything has called it, which is `PlayoutControlClient.downSince`'s own convention.
     */
    downForMs?: number;
    /**
     * How long Liquidsoap has reported the mount on its bed while deadair held the lease.
     * `undefined` while it has not.
     */
    starvedForMs?: number;
    /**
     * Whether the last reading said the queue was producing audio. `undefined` with no reading, or
     * from a `radio.liq` too old to report it.
     *
     * Required to be `false`, and not merely absent, before a starve counts. The app's starve clock
     * is cleared only by Liquidsoap reporting a recovery, and a Liquidsoap that has just been
     * restarted has nothing to recover from, so after a restart the clock can still be running over
     * a chain that is playing perfectly well. The reading is the fresher of the two.
     */
    ready?: boolean;
    /** Requests Liquidsoap says it is holding, from the last reading. `undefined` with no reading. */
    queued?: number;
}

/** What the watchdog remembers between readings. Start from {@link FRESH_WATCHDOG}. */
export interface WatchdogMemory {
    /** When a restart was last asked for. */
    lastRequestAt?: number;
    /** Restarts asked for since the chain was last seen working. */
    unanswered: number;
    /** Whether it has already said it is giving up, so that it says so once. */
    gaveUp: boolean;
}

export const FRESH_WATCHDOG: WatchdogMemory = { unanswered: 0, gaveUp: false };

/** What to do about this reading. */
export type WatchdogVerdict =
    | { action: 'none' }
    | { action: 'restart'; reason: StuckReason; stuckForMs: number; detail: string }
    | { action: 'giveUp'; reason: StuckReason; stuckForMs: number; detail: string };

const NONE: WatchdogVerdict = { action: 'none' };

/**
 * Judge one reading of the audio chain.
 *
 * Answers the verdict and the memory to carry into the next reading. A chain seen working, meaning
 * it answers and is not holding the mount on its bed, clears the memory whatever else is true,
 * because the attempts bound is about restarts that did not help and one that led to a working
 * chain did.
 */
export function judgeAudioChain(facts: ChainFacts, memory: WatchdogMemory): { verdict: WatchdogVerdict; memory: WatchdogMemory } {
    const answering = facts.downForMs === undefined;
    const producing = facts.starvedForMs === undefined || facts.ready !== false;
    if (answering && producing) return { verdict: NONE, memory: FRESH_WATCHDOG };

    const stuck = stuckFor(facts);
    if (stuck === undefined || !facts.enabled || memory.gaveUp) return { verdict: NONE, memory };

    if (memory.lastRequestAt !== undefined && facts.now - memory.lastRequestAt < RESTART_COOLDOWN_MS) return { verdict: NONE, memory };

    if (memory.unanswered >= RESTART_ATTEMPTS) {
        return {
            verdict: { action: 'giveUp', ...stuck, detail: giveUpDetail(stuck.reason, memory.unanswered) },
            memory: { ...memory, gaveUp: true },
        };
    }

    return {
        verdict: { action: 'restart', ...stuck, detail: restartDetail(stuck) },
        memory: { lastRequestAt: facts.now, unanswered: memory.unanswered + 1, gaveUp: false },
    };
}

/** Which signature the chain is showing, and for how long, or `undefined` for neither. */
function stuckFor(facts: ChainFacts): { reason: StuckReason; stuckForMs: number } | undefined {
    if (facts.downForMs !== undefined) {
        return facts.downForMs >= UNREACHABLE_AFTER_MS ? { reason: 'notAnswering', stuckForMs: facts.downForMs } : undefined;
    }
    const holding = (facts.queued ?? 0) >= 1;
    if (facts.wantsAir && holding && facts.ready === false && facts.starvedForMs !== undefined && facts.starvedForMs >= STUCK_AFTER_MS) {
        return { reason: 'holdingNotPlaying', stuckForMs: facts.starvedForMs };
    }
    return undefined;
}

function restartDetail(stuck: { reason: StuckReason; stuckForMs: number }): string {
    const seconds = Math.round(stuck.stuckForMs / 1000);
    return stuck.reason === 'holdingNotPlaying'
        ? `The audio chain has held a record for ${seconds}s without playing it, so the station asked for it to be restarted.`
        : `The audio chain has not answered for ${seconds}s, so the station asked for it to be restarted.`;
}

function giveUpDetail(reason: StuckReason, attempts: number): string {
    const what = reason === 'holdingNotPlaying' ? 'is still holding a record without playing it' : 'is still not answering';
    return `The audio chain ${what} after ${attempts} restarts, so the station has stopped asking. Restart the container to bring it back.`;
}
