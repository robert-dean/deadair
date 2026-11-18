import { describe, expect, it } from 'vitest';

import { trackReadiness } from '../../../src/components/catalog/catalog.tracks.page';

describe('trackReadiness', () => {
    it('reads suspended first, whatever the bytes are doing', () => {
        expect(trackReadiness({ hasAudio: true, measured: true, suspended: true })).toBe('suspended');
    });

    it('reads a record with no audio here as not fetched, even when it was measured once', () => {
        expect(trackReadiness({ hasAudio: false, measured: true })).toBe('notFetched');
    });

    it('tells a measured record from one still waiting to be measured', () => {
        expect(trackReadiness({ hasAudio: true, measured: true })).toBe('ready');
        expect(trackReadiness({ hasAudio: true, measured: false })).toBe('unmeasured');
    });
});
