// An HLS listener is counted from the requests their player makes anyway, so the whole
// of this class is a window: who has been heard from recently enough to still be there.
// Both edges of that window are load-bearing. Too short and a listener flickers in and
// out between playlist fetches, which in `audience` mode is a station that keeps cutting
// itself off. Too long and somebody who closed their player holds the mount up.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HLS_PRESENCE_MS, HlsAudience, type HlsClient } from '../../../src/modules/stream/hls.audience.js';

/** A client named by its address alone, for the tests that only care that two are different. */
const at = (address: string): HlsClient => ({ address });

describe('HlsAudience', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('counts nobody until somebody asks for a playlist', () => {
        expect(new HlsAudience().count()).toBe(0);
    });

    it('counts one client once, however many times it ticks', () => {
        // A player fetches the playlist repeatedly by design, which is the whole mechanism.
        // Counting the REQUESTS rather than the clients would report one listener as a
        // crowd that grows for as long as they keep listening.
        const hls = new HlsAudience();

        hls.seen(at('a'));
        hls.seen(at('a'));
        hls.seen(at('a'));

        expect(hls.count()).toBe(1);
    });

    it('knows a client it is counting, and forgets one it has stopped hearing from', () => {
        // What lets a listener cap turn away somebody new without cutting off somebody listening.
        const hls = new HlsAudience();

        hls.seen(at('a'));
        expect(hls.has(at('a'))).toBe(true);
        expect(hls.has(at('b'))).toBe(false);

        vi.advanceTimersByTime(HLS_PRESENCE_MS + 1);
        expect(hls.has(at('a'))).toBe(false);
    });

    it('counts distinct clients separately', () => {
        const hls = new HlsAudience();

        hls.seen(at('a'));
        hls.seen(at('b'));

        expect(hls.count()).toBe(2);
    });

    it('forgets a client that has stopped asking', () => {
        const hls = new HlsAudience();
        hls.seen(at('a'));

        vi.advanceTimersByTime(HLS_PRESENCE_MS + 1);

        // No event says a listener left — a departure is the ABSENCE of a request — so
        // ageing out is the only way anybody notices, and it has to happen without a
        // timer of its own because there is no loop here to hang one on.
        expect(hls.count()).toBe(0);
    });

    it('keeps a client that is still asking', () => {
        const hls = new HlsAudience();
        hls.seen(at('a'));

        // Most of the way through the window, then another tick: a player fetching once
        // per segment must never lapse between fetches.
        vi.advanceTimersByTime(HLS_PRESENCE_MS - 1);
        hls.seen(at('a'));
        vi.advanceTimersByTime(HLS_PRESENCE_MS - 1);

        expect(hls.count()).toBe(1);
    });

    it('drops only the client that went quiet', () => {
        const hls = new HlsAudience();
        hls.seen(at('gone'));

        vi.advanceTimersByTime(HLS_PRESENCE_MS - 1);
        hls.seen(at('still-here'));
        vi.advanceTimersByTime(2);

        expect(hls.count()).toBe(1);
    });

    it('announces an arrival, so the gate can move before the next poll', () => {
        // The same bargain the Icecast event feed makes: the push beats the poll to the
        // edge, and the poll is what makes a missed push harmless.
        const hls = new HlsAudience();
        const changes: number[] = [];
        hls.onChange(() => changes.push(hls.count()));

        hls.seen(at('a'));

        expect(changes).toEqual([1]);
    });

    it('says nothing when a client that is already counted ticks again', () => {
        // Otherwise every playlist fetch by every listener would wake the gate, which on
        // a station with an audience is a recount several times a second forever.
        const hls = new HlsAudience();
        hls.seen(at('a'));
        const changes: number[] = [];
        hls.onChange(() => changes.push(hls.count()));

        hls.seen(at('a'));

        expect(changes).toEqual([]);
    });

    it('keeps counting when a subscriber throws', () => {
        // This class sits on the path of every playlist request. A subscriber that throws
        // must not cost a listener their tick, let alone their audio.
        const hls = new HlsAudience();
        hls.onChange(() => {
            throw new Error('a subscriber that cannot cope');
        });

        expect(() => hls.seen(at('a'))).not.toThrow();
        expect(hls.count()).toBe(1);
    });

    it('stops telling an unsubscribed listener', () => {
        const hls = new HlsAudience();
        const changes: number[] = [];
        const off = hls.onChange(() => changes.push(hls.count()));

        off();
        hls.seen(at('a'));

        expect(changes).toEqual([]);
    });

    describe('who is there', () => {
        // The count's list: what an operator is shown when they ask who is listening over HLS.
        // It has to be the same window as the count, or the page and the tally disagree.
        const T0 = Date.parse('2026-10-28T12:00:00Z');

        beforeEach(() => {
            vi.setSystemTime(T0);
        });

        it('lists each player with its address, its agent and since when', () => {
            const hls = new HlsAudience();

            hls.seen({ address: '203.0.113.7', agent: 'VLC/3.0.21' });
            vi.advanceTimersByTime(4000);
            hls.seen({ address: '203.0.113.7', agent: 'VLC/3.0.21' });

            expect(hls.present()).toEqual([{ address: '203.0.113.7', agent: 'VLC/3.0.21', firstSeenAt: T0, lastSeenAt: T0 + 4000 }]);
        });

        it('counts one address under two players as two listeners', () => {
            const hls = new HlsAudience();

            hls.seen({ address: '203.0.113.7', agent: 'VLC/3.0.21' });
            hls.seen({ address: '203.0.113.7', agent: 'Safari' });
            hls.seen({ address: '203.0.113.7' });

            expect(hls.count()).toBe(3);
            expect(hls.present().map(presence => presence.agent)).toEqual(['VLC/3.0.21', 'Safari', undefined]);
        });

        it('keeps the first tick while the player keeps asking', () => {
            const hls = new HlsAudience();

            for (let tick = 0; tick < 30; tick++) {
                hls.seen(at('a'));
                vi.advanceTimersByTime(2000);
            }

            expect(hls.present()[0]?.firstSeenAt).toBe(T0);
        });

        it('starts a new stretch for a player that lapsed, even before the prune', () => {
            // Nothing between the two ticks counts or lists, so the stale entry is still in the
            // map when the player comes back. It must not hand its old start to the new stretch.
            const hls = new HlsAudience();
            hls.seen(at('a'));

            vi.advanceTimersByTime(HLS_PRESENCE_MS + 1);
            hls.seen(at('a'));

            expect(hls.present()).toEqual([{ address: 'a', firstSeenAt: T0 + HLS_PRESENCE_MS + 1, lastSeenAt: T0 + HLS_PRESENCE_MS + 1 }]);
        });

        it('lists the longest-listening first and leaves out whoever went quiet', () => {
            const hls = new HlsAudience();
            hls.seen(at('gone'));
            vi.advanceTimersByTime(1000);
            hls.seen(at('early'));
            vi.advanceTimersByTime(1000);
            hls.seen(at('late'));

            vi.advanceTimersByTime(HLS_PRESENCE_MS - 1500);
            hls.seen(at('late'));
            hls.seen(at('early'));

            expect(hls.present().map(presence => presence.address)).toEqual(['early', 'late']);
            expect(hls.count()).toBe(2);
        });

        it('hands out a copy that cannot edit the register', () => {
            const hls = new HlsAudience();
            hls.seen(at('a'));

            const [presence] = hls.present();
            if (presence) presence.lastSeenAt = 0;

            expect(hls.has(at('a'))).toBe(true);
        });
    });
});
