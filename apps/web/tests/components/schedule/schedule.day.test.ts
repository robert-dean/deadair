import { describe, expect, it } from 'vitest';

import { stationClockAt } from '../../../src/components/schedule/schedule.day';

describe('stationClockAt', () => {
    it('carries the station’s last reading forward by the time since it came', () => {
        expect(stationClockAt('2026-10-15 14:01:35', 90_000)).toBe('2026-10-15 14:03:05');
    });

    it('crosses the station’s midnight on its own calendar', () => {
        expect(stationClockAt('2026-10-15 23:59:30', 45_000)).toBe('2026-10-16 00:00:15');
    });

    it('never runs the clock backwards', () => {
        expect(stationClockAt('2026-10-15 14:01:35', -5_000)).toBe('2026-10-15 14:01:35');
    });
});
