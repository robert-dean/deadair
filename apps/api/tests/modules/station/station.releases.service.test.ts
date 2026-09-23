// The releases read. What is worth pinning is the wire shape: a heading's date crosses as an ISO date
// and one with none crosses with the field absent, and a build with no changelog answers no `current`.

import { describe, expect, it } from 'vitest';

import { BundledChangelog } from '../../../src/modules/station/station.changelog.js';
import { StationReleasesService } from '../../../src/modules/station/station.releases.service.js';
import { StationReleases } from '../../../src/modules/station/types/station.types.js';

describe('StationReleasesService.read', () => {
    it('answers the release this build contains and every entry newest first', async () => {
        const reading = await new StationReleasesService(
            new BundledChangelog([
                { version: '0.26.2', date: '2026-09-23', notes: '- Fixed.' },
                { version: '0.26.1', notes: '' },
            ]),
        ).read();

        expect(reading.current).toBe('0.26.2');
        expect(reading.notes).toHaveLength(2);
        // A day crosses as the ISO date it is. A Luxon value would be written as a UTC midnight
        // timestamp, which the SDK's `yyyy-MM-dd` reader refuses.
        expect(reading.notes[0]!.date).toBe('2026-09-23');
        expect(reading.notes[1]).toEqual({ version: '0.26.1', notes: '' });
        // The whole answer, serialised the way the router's response is, is what the contract accepts.
        expect(() => StationReleases.parse(JSON.parse(JSON.stringify(reading)))).not.toThrow();
    });

    it('answers no current release and no notes for a build with no changelog', async () => {
        expect(await new StationReleasesService(new BundledChangelog()).read()).toEqual({ notes: [] });
    });
});
