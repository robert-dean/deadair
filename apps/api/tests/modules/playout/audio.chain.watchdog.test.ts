// The thresholds and the bounds are the feature. Most cases here are readings the live station
// actually produced: the 2026-09-13 hang that needed a restart by hand, the twelve-second control
// stalls it recovers from on its own every day or two, and the half-second gap every first listener
// hears. The rest are the ways a restart could become a loop.

import { describe, expect, it } from 'vitest';

import {
    FRESH_WATCHDOG,
    judgeAudioChain,
    RESTART_ATTEMPTS,
    RESTART_COOLDOWN_MS,
    STUCK_AFTER_MS,
    UNREACHABLE_AFTER_MS,
    type ChainFacts,
    type WatchdogMemory,
} from '../../../src/modules/playout/audio.chain.watchdog.js';

const NOW = 10_000_000;

/** A chain airing normally to one listener. Every test starts here and breaks one thing. */
const working = (over: Partial<ChainFacts> = {}): ChainFacts => ({
    now: NOW,
    enabled: true,
    wantsAir: true,
    ready: true,
    queued: 1,
    ...over,
});

/** The 2026-09-13 reading: the lease held, a record handed over and held, and the bed on the mount. */
const holding = (starvedForMs: number, over: Partial<ChainFacts> = {}): ChainFacts => working({ starvedForMs, ready: false, queued: 1, ...over });

describe('judgeAudioChain', () => {
    it('does nothing about a chain that is working', () => {
        const { verdict, memory } = judgeAudioChain(working(), FRESH_WATCHDOG);

        expect(verdict).toEqual({ action: 'none' });
        expect(memory).toEqual(FRESH_WATCHDOG);
    });

    it('asks for a restart once a chain has held a record for a minute without playing it', () => {
        const { verdict, memory } = judgeAudioChain(holding(STUCK_AFTER_MS), FRESH_WATCHDOG);

        expect(verdict).toMatchObject({ action: 'restart', reason: 'holdingNotPlaying', stuckForMs: STUCK_AFTER_MS });
        expect(verdict.action === 'restart' && verdict.detail).toBe(
            'The audio chain has held a record for 60s without playing it, so the station asked for it to be restarted.',
        );
        expect(memory).toEqual({ lastRequestAt: NOW, unanswered: 1, gaveUp: false });
    });

    it('waits out the minute', () => {
        expect(judgeAudioChain(holding(STUCK_AFTER_MS - 1), FRESH_WATCHDOG).verdict).toEqual({ action: 'none' });
    });

    it('leaves the gap every first listener hears alone', () => {
        // Measured on the live station: ~500ms, because nothing is queued while the audience gate is shut.
        expect(judgeAudioChain(holding(500), FRESH_WATCHDOG).verdict).toEqual({ action: 'none' });
    });

    it('does not restart a chain the transport has handed nothing', () => {
        // A starve with an empty queue is the app having nothing to give, and a restart fixes none of that.
        expect(judgeAudioChain(holding(5 * STUCK_AFTER_MS, { queued: 0 }), FRESH_WATCHDOG).verdict).toEqual({ action: 'none' });
        expect(judgeAudioChain(holding(5 * STUCK_AFTER_MS, { queued: undefined }), FRESH_WATCHDOG).verdict).toEqual({ action: 'none' });
    });

    it('trusts a reading that says the queue is producing over a starve clock that was never cleared', () => {
        // After a restart of Liquidsoap alone, nothing reports a recovery and the app's clock runs on.
        const after = { lastRequestAt: NOW - RESTART_COOLDOWN_MS, unanswered: 1, gaveUp: false };
        const { verdict, memory } = judgeAudioChain(holding(10 * STUCK_AFTER_MS, { ready: true }), after);

        expect(verdict).toEqual({ action: 'none' });
        expect(memory).toEqual(FRESH_WATCHDOG);
    });

    it('does not count a starve from a script too old to say whether it is producing', () => {
        expect(judgeAudioChain(holding(10 * STUCK_AFTER_MS, { ready: undefined }), FRESH_WATCHDOG).verdict).toEqual({ action: 'none' });
    });

    it('does not judge a starve while the station does not want the mount', () => {
        expect(judgeAudioChain(holding(10 * STUCK_AFTER_MS, { wantsAir: false }), FRESH_WATCHDOG).verdict).toEqual({ action: 'none' });
    });

    it('leaves the control stalls the chain recovers from on its own', () => {
        // The station's own log, 2026-09-04 to 2026-09-14: bursts of up to about twelve seconds, every one recovered.
        expect(judgeAudioChain(working({ downForMs: 12_000 }), FRESH_WATCHDOG).verdict).toEqual({ action: 'none' });
    });

    it('asks for a restart once the chain has not answered for a minute, whether or not anybody is listening', () => {
        const { verdict } = judgeAudioChain(working({ downForMs: UNREACHABLE_AFTER_MS, wantsAir: false }), FRESH_WATCHDOG);

        expect(verdict).toMatchObject({ action: 'restart', reason: 'notAnswering', stuckForMs: UNREACHABLE_AFTER_MS });
        expect(verdict.action === 'restart' && verdict.detail).toBe(
            'The audio chain has not answered for 60s, so the station asked for it to be restarted.',
        );
    });

    it('does nothing when the operator has switched it off', () => {
        const { verdict, memory } = judgeAudioChain(holding(10 * STUCK_AFTER_MS, { enabled: false }), FRESH_WATCHDOG);

        expect(verdict).toEqual({ action: 'none' });
        expect(memory).toEqual(FRESH_WATCHDOG);
    });

    it('asks at most once per cooldown', () => {
        const first = judgeAudioChain(holding(STUCK_AFTER_MS), FRESH_WATCHDOG);
        const soon = judgeAudioChain(holding(STUCK_AFTER_MS, { now: NOW + RESTART_COOLDOWN_MS - 1 }), first.memory);
        const later = judgeAudioChain(holding(STUCK_AFTER_MS, { now: NOW + RESTART_COOLDOWN_MS }), first.memory);

        expect(soon.verdict).toEqual({ action: 'none' });
        expect(later.verdict).toMatchObject({ action: 'restart' });
        expect(later.memory.unanswered).toBe(2);
    });

    it('gives up once, after the restarts it is allowed have not helped, and then stays quiet', () => {
        let memory: WatchdogMemory = FRESH_WATCHDOG;
        for (let attempt = 0; attempt < RESTART_ATTEMPTS; attempt++) {
            const result = judgeAudioChain(holding(STUCK_AFTER_MS, { now: NOW + attempt * RESTART_COOLDOWN_MS }), memory);
            expect(result.verdict).toMatchObject({ action: 'restart' });
            memory = result.memory;
        }

        const giving = judgeAudioChain(holding(STUCK_AFTER_MS, { now: NOW + RESTART_ATTEMPTS * RESTART_COOLDOWN_MS }), memory);
        expect(giving.verdict).toMatchObject({ action: 'giveUp', reason: 'holdingNotPlaying' });
        expect(giving.verdict.action === 'giveUp' && giving.verdict.detail).toBe(
            'The audio chain is still holding a record without playing it after 3 restarts, so the station has stopped asking. Restart the container to bring it back.',
        );

        const after = judgeAudioChain(holding(STUCK_AFTER_MS, { now: NOW + 10 * RESTART_COOLDOWN_MS }), giving.memory);
        expect(after.verdict).toEqual({ action: 'none' });
    });

    it('starts counting again once the chain has been seen working', () => {
        const spent = { lastRequestAt: NOW - RESTART_COOLDOWN_MS, unanswered: RESTART_ATTEMPTS, gaveUp: true };
        const recovered = judgeAudioChain(working(), spent);
        const again = judgeAudioChain(holding(STUCK_AFTER_MS), recovered.memory);

        expect(recovered.memory).toEqual(FRESH_WATCHDOG);
        expect(again.verdict).toMatchObject({ action: 'restart' });
    });

    it('does not take a chain that is restarting as working', () => {
        // Between the request and the new process, the control API does not answer. That is not recovery.
        const spent = { lastRequestAt: NOW - 1_000, unanswered: 1, gaveUp: false };

        expect(judgeAudioChain(working({ downForMs: 3_000 }), spent).memory).toEqual(spent);
    });
});
