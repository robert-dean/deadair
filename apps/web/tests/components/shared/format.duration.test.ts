import { describe, expect, it } from 'vitest';

import { formatDuration } from '../../../src/components/shared/format.duration';

describe('formatDuration', () => {
    it.each([
        [0, '0:00'],
        [4_000, '0:04'],
        [215_400, '3:35'],
        [3_599_000, '59:59'],
    ])('reads %d ms as %s, which is every record the station has ever played', (ms, expected) => {
        expect(formatDuration(ms)).toBe(expected);
    });

    // An episode of somebody else's programme runs an hour and more, and `90:00` is not how anybody
    // reads an hour and a half, on the Podcasts page or on the desk while it airs.
    it.each([
        [3_600_000, '1:00:00'],
        [3_723_000, '1:02:03'],
        [5_400_000, '1:30:00'],
        [10_200_000, '2:50:00'],
    ])('reads %d ms as %s from an hour up', (ms, expected) => {
        expect(formatDuration(ms)).toBe(expected);
    });

    it('renders nothing for a length nobody knows, rather than claiming one', () => {
        expect(formatDuration(undefined)).toBe('');
    });
});
