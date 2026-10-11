// The end of a record is the decision this container gets most chances to get wrong, and every wrong
// answer is silent: stop too early and the last seconds are missing, stop too late and there is
// silence welded on, never stop and one record holds the only browser until its ceiling.
//
// So `playToEnd` is tested against a scripted player rather than a real one. What cannot be tested
// here is whether MusicKit reports the states these tests feed it — that needs a subscription, and
// stream/apple-player/README.md says so rather than leaving it implied.

import { describe, expect, it, vi } from 'vitest';

import { isUnplayable, PlaybackRefused, playToEnd, type PlayerHandle, type PlayerReading } from '../src/player.ts';

/** A player that answers a scripted sequence of readings, then repeats the last one forever. */
function scripted(readings: PlayerReading[]): PlayerHandle {
    let index = 0;
    return {
        install: async () => ({ installed: true }),
        ensure: async () => ({ installed: true }),
        read: async () => readings[Math.min(index++, readings.length - 1)]!,
        authorized: async () => true,
        start: async () => undefined,
        stop: async () => undefined,
    };
}

const reading = (over: Partial<PlayerReading> = {}): PlayerReading => ({
    isPlaying: true,
    time: 0,
    duration: 180,
    title: 'Roads',
    authorized: true,
    states: [],
    ...over,
});

// Time is driven by the poll callback rather than by timers: the loop's own clock reads `Date.now`,
// so a test that advanced fake timers would still have to let the loop run. Advancing a mocked
// system time inside the poll is both simpler and closer to what the loop actually observes.
function clockedPoll(): (ms: number) => Promise<void> {
    return async (ms: number) => {
        vi.setSystemTime(Date.now() + ms);
    };
}

describe('playToEnd', () => {
    it('finishes when the player says the record completed', async () => {
        vi.useFakeTimers();
        try {
            const played = await playToEnd(scripted([reading({ time: 1 }), reading({ time: 179, lastState: 'completed' })]), {
                slackMs: 60_000,
                stallMs: 20_000,
                poll: clockedPoll(),
            });
            expect(played.title).toBe('Roads');
            expect(played.durationMs).toBe(180_000);
        } finally {
            vi.useRealTimers();
        }
    });

    it('finishes when the position reaches the duration, without a completed state', async () => {
        // The backstop. A state we never see costs nothing to work around and saves a whole capture,
        // which is four minutes of the only browser.
        vi.useFakeTimers();
        try {
            const played = await playToEnd(scripted([reading({ time: 1 }), reading({ time: 180 })]), {
                slackMs: 60_000,
                stallMs: 20_000,
                poll: clockedPoll(),
            });
            expect(played.playedMs).toBe(180_000);
        } finally {
            vi.useRealTimers();
        }
    });

    it('fails when the position stops advancing while the player claims to be playing', async () => {
        // A stall has to be a failure rather than a wait: waiting hands the station a record with
        // silence on the end of it, and nothing downstream can tell that from a quiet outro.
        vi.useFakeTimers();
        try {
            await expect(playToEnd(scripted([reading({ time: 12 })]), { slackMs: 600_000, stallMs: 5_000, poll: clockedPoll() })).rejects.toThrow(
                /stalled at 12000ms/,
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('gives up at the record duration plus the slack', async () => {
        vi.useFakeTimers();
        try {
            // Never stalls (the position keeps moving) and never ends, which is the one case the
            // ceiling exists for.
            let time = 0;
            const creeping: PlayerHandle = {
                ...scripted([reading()]),
                read: async () => reading({ time: (time += 0.1) }),
            };
            await expect(playToEnd(creeping, { slackMs: 1_000, stallMs: 600_000, poll: clockedPoll() })).rejects.toThrow(
                /did not finish inside its duration plus 1000ms/,
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports a playback error, and says whether the copy is unplayable', async () => {
        await expect(playToEnd(scripted([reading({ error: 'CONTENT_RESTRICTED' })]), { slackMs: 1_000, stallMs: 1_000 })).rejects.toMatchObject({
            unplayable: true,
        });

        await expect(playToEnd(scripted([reading({ error: 'network hiccup' })]), { slackMs: 1_000, stallMs: 1_000 })).rejects.toMatchObject({
            unplayable: false,
        });
    });

    it('carries the refusal as a PlaybackRefused, so the server can pick a status', async () => {
        const error = await playToEnd(scripted([reading({ error: 'not available in this storefront' })]), {
            slackMs: 1_000,
            stallMs: 1_000,
        }).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(PlaybackRefused);
    });
});

describe('isUnplayable', () => {
    it('names the refusals that mean this copy will never play here', () => {
        expect(isUnplayable('CONTENT_RESTRICTED')).toBe(true);
        expect(isUnplayable('This song is not available in your country')).toBe(true);
        expect(isUnplayable('RESTRICTED_REGION')).toBe(true);
    });

    it('errs towards a retry for anything it does not recognise', () => {
        // A record wrongly benched is invisible until somebody wonders why it never airs; a record
        // wrongly retried costs four fetches and then benches itself.
        expect(isUnplayable('stalled')).toBe(false);
        expect(isUnplayable('the player did not start inside 45000ms')).toBe(false);
        expect(isUnplayable('')).toBe(false);
    });
});
