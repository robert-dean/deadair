// The whole point of `register` is that boot is not a special case: a loop that has
// started and not yet finished its first pass has to be measurable, or every reader
// invents its own grace window and they all pick a different one.

import { describe, expect, it } from 'vitest';

import { Heartbeat } from '../../../src/modules/shared/heartbeat.js';

describe('Heartbeat', () => {
    it('measures from the registration until the first beat lands', () => {
        const heartbeat = new Heartbeat();
        heartbeat.register('playout.reconcile', 1_000);

        expect(heartbeat.stalledFor('playout.reconcile', 5_000)).toBe(4_000);
    });

    it('measures from the last beat once there has been one', () => {
        const heartbeat = new Heartbeat();
        heartbeat.register('playout.reconcile', 1_000);
        heartbeat.beat('playout.reconcile', 4_000);

        expect(heartbeat.stalledFor('playout.reconcile', 5_000)).toBe(1_000);
    });

    it('answers `undefined` for a loop nobody is watching', () => {
        // Not zero and not infinity: a missing call is a question about the code, and a
        // reader that turned it into a fault would report it as a broken station.
        expect(new Heartbeat().stalledFor('nothing.registered', 5_000)).toBeUndefined();
    });

    it('starts watching a loop that beat without registering', () => {
        // A loop that forgot the register call should still report honestly rather than
        // silently never being watched.
        const heartbeat = new Heartbeat();
        heartbeat.beat('audience.poll', 2_000);

        expect(heartbeat.stalledFor('audience.poll', 3_000)).toBe(1_000);
    });

    it('restarts the measurement when a loop registers again', () => {
        // Which is what a loop stopped and started again actually is.
        const heartbeat = new Heartbeat();
        heartbeat.register('audience.poll', 1_000);
        heartbeat.beat('audience.poll', 2_000);
        heartbeat.register('audience.poll', 9_000);

        expect(heartbeat.stalledFor('audience.poll', 10_000)).toBe(1_000);
    });

    it('never answers negative for a clock that went backwards', () => {
        const heartbeat = new Heartbeat();
        heartbeat.beat('audience.poll', 5_000);

        expect(heartbeat.stalledFor('audience.poll', 4_000)).toBe(0);
    });

    it('stops reporting on a loop that was stopped on purpose', () => {
        const heartbeat = new Heartbeat();
        heartbeat.register('playout.reconcile', 1_000);
        heartbeat.forget('playout.reconcile');

        expect(heartbeat.stalledFor('playout.reconcile', 5_000)).toBeUndefined();
    });

    it('reports every loop it is watching', () => {
        const heartbeat = new Heartbeat();
        heartbeat.register('playout.reconcile', 1_000);
        heartbeat.register('audience.poll', 1_000);
        heartbeat.beat('audience.poll', 2_000);

        expect(heartbeat.all()).toEqual([
            { name: 'playout.reconcile', startedAt: 1_000 },
            { name: 'audience.poll', startedAt: 1_000, lastBeat: 2_000 },
        ]);
    });
});
