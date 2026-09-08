import type { StationAir } from '@deadair/sdk';

/** A station on air. What it is airing is its own running order, not a stored list. */
export function stationAir(overrides: Partial<StationAir> = {}): StationAir {
    return {
        active: true,
        airMode: 'audience',
        name: 'Late shift',
        source: 'import',
        remaining: 2,
        // Both required on `StationAir` and both about who is driving rather than what is
        // playing, so the default is the ordinary case: the director, un-held.
        airSource: 'operator',
        held: false,
        ...overrides,
    };
}
