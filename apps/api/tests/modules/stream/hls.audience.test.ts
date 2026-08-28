// An HLS listener is counted from the requests their player makes anyway, so the whole
// of this class is a window: who has been heard from recently enough to still be there.
// Both edges of that window are load-bearing. Too short and a listener flickers in and
// out between playlist fetches, which in `audience` mode is a station that keeps cutting
// itself off. Too long and somebody who closed their player holds the mount up.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HLS_PRESENCE_MS, HlsAudience } from '../../../src/modules/stream/hls.audience.js';

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

        hls.seen('a');
        hls.seen('a');
        hls.seen('a');

        expect(hls.count()).toBe(1);
    });

    it('counts distinct clients separately', () => {
        const hls = new HlsAudience();

        hls.seen('a');
        hls.seen('b');

        expect(hls.count()).toBe(2);
    });

    it('forgets a client that has stopped asking', () => {
        const hls = new HlsAudience();
        hls.seen('a');

        vi.advanceTimersByTime(HLS_PRESENCE_MS + 1);

        // No event says a listener left — a departure is the ABSENCE of a request — so
        // ageing out is the only way anybody notices, and it has to happen without a
        // timer of its own because there is no loop here to hang one on.
        expect(hls.count()).toBe(0);
    });

    it('keeps a client that is still asking', () => {
        const hls = new HlsAudience();
        hls.seen('a');

        // Most of the way through the window, then another tick: a player fetching once
        // per segment must never lapse between fetches.
        vi.advanceTimersByTime(HLS_PRESENCE_MS - 1);
        hls.seen('a');
        vi.advanceTimersByTime(HLS_PRESENCE_MS - 1);

        expect(hls.count()).toBe(1);
    });

    it('drops only the client that went quiet', () => {
        const hls = new HlsAudience();
        hls.seen('gone');

        vi.advanceTimersByTime(HLS_PRESENCE_MS - 1);
        hls.seen('still-here');
        vi.advanceTimersByTime(2);

        expect(hls.count()).toBe(1);
    });

    it('announces an arrival, so the gate can move before the next poll', () => {
        // The same bargain the Icecast event feed makes: the push beats the poll to the
        // edge, and the poll is what makes a missed push harmless.
        const hls = new HlsAudience();
        const changes: number[] = [];
        hls.onChange(() => changes.push(hls.count()));

        hls.seen('a');

        expect(changes).toEqual([1]);
    });

    it('says nothing when a client that is already counted ticks again', () => {
        // Otherwise every playlist fetch by every listener would wake the gate, which on
        // a station with an audience is a recount several times a second forever.
        const hls = new HlsAudience();
        hls.seen('a');
        const changes: number[] = [];
        hls.onChange(() => changes.push(hls.count()));

        hls.seen('a');

        expect(changes).toEqual([]);
    });

    it('keeps counting when a subscriber throws', () => {
        // This class sits on the path of every playlist request. A subscriber that throws
        // must not cost a listener their tick, let alone their audio.
        const hls = new HlsAudience();
        hls.onChange(() => {
            throw new Error('a subscriber that cannot cope');
        });

        expect(() => hls.seen('a')).not.toThrow();
        expect(hls.count()).toBe(1);
    });

    it('stops telling an unsubscribed listener', () => {
        const hls = new HlsAudience();
        const changes: number[] = [];
        const off = hls.onChange(() => changes.push(hls.count()));

        off();
        hls.seen('a');

        expect(changes).toEqual([]);
    });
});
