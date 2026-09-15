import { describe, expect, it } from 'vitest';

import { readTransport } from '../../src/station/transport.reading.js';
import { airing, stoodDown, stoodDownAndUnreachable, waitingForListener } from '../fixtures/playout.status.js';

describe('readTransport', () => {
    it('reads a record on air as live and skippable', () => {
        expect(readTransport(airing())).toEqual({ live: true, stoodDown: false, canSkip: true, tone: 'live', label: 'on air' });
    });

    it('reads a stood-down station as off, with Start to offer', () => {
        expect(readTransport(stoodDown())).toMatchObject({ live: false, stoodDown: true, canSkip: false, tone: 'off', label: 'off air' });
    });

    it('still knows the station is stood down when another gate is named as the cause', () => {
        expect(readTransport(stoodDownAndUnreachable())).toMatchObject({ stoodDown: true, tone: 'fault', label: 'stream unreachable' });
    });

    it('draws an audience-gated station waiting for a listener as ready, not as a fault', () => {
        expect(readTransport(waitingForListener())).toMatchObject({ live: false, stoodDown: false, tone: 'standby', label: 'ready' });
    });

    it('offers no Skip without a stream to skip on', () => {
        expect(readTransport(airing({ streamUp: false })).canSkip).toBe(false);
    });
});
