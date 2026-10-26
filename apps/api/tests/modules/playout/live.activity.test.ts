// Which of the live input's changes reach the activity feed, and that each one does once.

import { describe, expect, it, vi } from 'vitest';

import { LiveActivity, liveEdge } from '../../../src/modules/playout/live.activity.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
import type { StationBus } from '../../../src/modules/shared/station.bus.js';
import type { LiveState, PlayoutControlClient } from '../../../src/modules/playout/liquidsoap.control.js';

describe('liveEdge', () => {
    it('writes down arming, going on the air and coming off it', () => {
        expect(liveEdge('armed', 'off')?.kind).toBe('live.armed');
        expect(liveEdge('onair', 'preroll')?.kind).toBe('live.on');
        expect(liveEdge('off', 'onair')).toEqual({ kind: 'live.off', detail: 'The live input handed the air back to the station.' });
    });

    it('tells a disarm before anybody went on apart from a hand-back', () => {
        expect(liveEdge('off', 'armed')).toEqual({ kind: 'live.off', detail: 'The live input was disarmed before anybody went on the air.' });
        expect(liveEdge('off', 'preroll')?.kind).toBe('live.off');
    });

    it('leaves the countdown out, and a signal lost during it', () => {
        expect(liveEdge('preroll', 'armed')).toBeUndefined();
        expect(liveEdge('armed', 'preroll')).toBeUndefined();
    });
});

describe('LiveActivity', () => {
    it('records each edge the control client reports, once, and publishes every change, even when started twice', () => {
        let listener: ((next: LiveState, previous: LiveState) => void) | undefined;
        const control = { onLiveChange: vi.fn((l: typeof listener) => (listener = l)) } as unknown as PlayoutControlClient;
        const record = vi.fn(async (_event: { kind: string }) => {});
        const publish = vi.fn();
        const watch = new LiveActivity(control, { record } as unknown as ActivityRecorder, { publish } as unknown as StationBus);

        watch.start();
        watch.start();
        listener?.('armed', 'off');
        listener?.('preroll', 'armed');
        listener?.('onair', 'preroll');

        expect(control.onLiveChange).toHaveBeenCalledTimes(1);
        expect(record.mock.calls.map(([event]) => event.kind)).toEqual(['live.armed', 'live.on']);
        expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ module: 'playout', data: { from: 'preroll', to: 'onair' } }));
        // Every change reaches the bus, the countdown included, in order.
        expect(publish.mock.calls.map(([, event]) => `${event.previous}->${event.state}`)).toEqual([
            'off->armed',
            'armed->preroll',
            'preroll->onair',
        ]);
        expect(publish).toHaveBeenCalledWith('live.changed', expect.objectContaining({ state: 'onair', previous: 'preroll' }));
    });
});
