// How long a model writer queues for the one model slot, which used to be ten seconds for every
// break and was wrong at BOTH ends.
//
// Too short for a planted break, ripened WRITE_AHEAD items ahead of its slot with minutes of
// headroom, giving up after ten seconds behind a twenty-five second production beat. And too long
// for an `interrupt`, whose entire lead is twenty seconds — a welcome that queues for half its
// budget has less left to be written and spoken in than it needs.

import { describe, expect, it } from 'vitest';

import { patienceFor, WAIT } from '../../../src/modules/director/break.writer.js';
import { URGENCY } from '../../../src/modules/director/break.planner.js';

const now = 1_000_000;

describe('patienceFor', () => {
    it('waits the station default when nothing said when this airs', () => {
        // Every ordinary planted break: only a clock band and a request stamp the row.
        expect(patienceFor(undefined, now)).toBe(WAIT.defaultMs);
    });

    it('waits longer than a production beat by default, which is the contention it exists for', () => {
        // A beat drafts in about 25 seconds. A break that gives up before that has waited long
        // enough to be annoying and not long enough to be useful.
        expect(patienceFor(undefined, now)).toBeGreaterThan(25_000);
    });

    it('gives a break with room the cap rather than all of it', () => {
        // A break planted half an hour ahead does not benefit from a worker sitting on the queue for
        // half an hour, and the floor underneath is a correct sentence rather than a failure.
        expect(patienceFor(now + 30 * 60_000, now)).toBe(WAIT.maxMs);
    });

    it('leaves room to speak the words after it has them', () => {
        const airsAt = now + 40_000;

        expect(patienceFor(airsAt, now)).toBe(40_000 - WAIT.reserveMs);
    });

    // The end that is easy to miss. An interrupt CANNOT wait for a beat, and a longer patience would
    // have it miss its slot rather than merely be late.
    it('keeps an interrupt short, because its whole lead is twenty seconds', () => {
        const airsAt = now + URGENCY.interrupt.leadMs;

        const patience = patienceFor(airsAt, now);
        expect(patience).toBeLessThan(10_000);
        expect(patience).toBeLessThan(URGENCY.interrupt.leadMs);
    });

    it('gives a `next` request real room, since it has ninety seconds', () => {
        expect(patienceFor(now + URGENCY.next.leadMs, now)).toBeGreaterThan(30_000);
    });

    it('answers zero for a break already at its slot rather than a negative wait', () => {
        // The gate reads zero as "admit me if the model is free, otherwise do not wait", which is
        // exactly right for something whose alternative is missing its moment.
        expect(patienceFor(now + 1_000, now)).toBe(0);
        expect(patienceFor(now - 60_000, now)).toBe(0);
    });
});
