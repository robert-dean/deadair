import { SdkError, type PlayoutStatus } from '@deadair/sdk';
import { vi } from 'vitest';

import { StatusPoller, type Playout } from '../../src/station/status.poller.js';
import { airing, stoodDown } from './playout.status.js';

/**
 * A station that answers the transport the way the real one does: Skip moves on, Stop stands it
 * down, Start brings it back or answers 409 with nothing to resume. `answer` swaps the reading.
 */
export function fakeStation(initial: PlayoutStatus = airing()) {
    let current = initial;
    let resumable = true;
    const playout = {
        getPlayoutStatus: vi.fn(async () => current),
        skipTheCurrentItem: vi.fn(async () => current),
        stopPlayout: vi.fn(async () => (current = stoodDown())),
        startPlayout: vi.fn(async () => {
            if (!resumable) throw new SdkError(409, 'Conflict', {}, new Headers());
            return (current = airing());
        }),
    } satisfies Playout;
    const poller = new StatusPoller();
    poller.reconfigure(playout);
    return {
        playout,
        poller,
        answer(status: PlayoutStatus) {
            current = status;
        },
        nothingToResume() {
            resumable = false;
        },
    };
}
