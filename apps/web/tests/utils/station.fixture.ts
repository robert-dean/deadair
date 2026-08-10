import type { StationAir } from '@deadair/sdk';

/** A station on air. What it is airing is its own running order, not a stored list. */
export function stationAir(overrides: Partial<StationAir> = {}): StationAir {
    return {
        active: true,
        airMode: 'audience',
        name: 'Late shift',
        source: 'import',
        remaining: 2,
        ...overrides,
    };
}
