import { Injectable } from 'injectkit';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { StationBus } from '#modules/shared/station.bus.js';
import { PlayoutControlClient, type LiveState } from './liquidsoap.control.js';

/** One row on the activity feed for a change of the live input's state, or `undefined` for none. */
export interface LiveEdge {
    kind: 'live.armed' | 'live.on' | 'live.off';
    detail: string;
}

/**
 * Which changes of the live input are worth a row.
 *
 * Three: armed, on the air, and off again. The pre-roll is not one, because it is three seconds on
 * the way to on air and a row for it would only ever sit directly under the next one. Off is phrased
 * by where it came from, since a hand-back after a show and a disarm before anybody went on are
 * different things to read the morning after.
 */
export function liveEdge(next: LiveState, previous: LiveState): LiveEdge | undefined {
    if (next === 'armed' && previous === 'off') {
        return { kind: 'live.armed', detail: 'The live input was armed. Real signal from an encoder on it starts the countdown to the air.' };
    }
    if (next === 'onair') return { kind: 'live.on', detail: 'A presenter took the air through the live input.' };
    if (next === 'off' && previous === 'onair') return { kind: 'live.off', detail: 'The live input handed the air back to the station.' };
    if (next === 'off') return { kind: 'live.off', detail: 'The live input was disarmed before anybody went on the air.' };
    return undefined;
}

/**
 * Writes the live input's edges to the activity feed, as the control client reads them, and tells
 * the director through `StationBus` (`live.changed`), which is registered after this module.
 *
 * On the client's own seam rather than on a timer of its own, because every reading already
 * passes through it in order and a second poll would see fewer of the edges than it does: an arm
 * followed by a disarm inside one tick would never appear.
 */
@Injectable()
export class LiveActivity {
    private started = false;

    constructor(
        private readonly control: PlayoutControlClient,
        private readonly activity: ActivityRecorder,
        private readonly bus: StationBus,
    ) {}

    /** Begin recording. Idempotent. */
    start(): void {
        if (this.started) return;
        this.started = true;
        this.control.onLiveChange((next, previous) => {
            // Every change, the countdown included: what to do about each is the subscriber's call.
            this.bus.publish('live.changed', { state: next, previous, at: Date.now() });
            const edge = liveEdge(next, previous);
            if (edge === undefined) return;
            // Voided: the recorder never throws, and the call that produced this reading must not
            // wait on a row. See `ActivityRecorder`.
            void this.activity.record({ module: 'playout', kind: edge.kind, detail: edge.detail, data: { from: previous, to: next } });
        });
    }
}
