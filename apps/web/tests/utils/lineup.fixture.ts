import type { Lineup, LineupItem, LineupSummary, StationAir } from '@deadair/sdk';

/**
 * One line of a lineup.
 *
 * `committed` defaults to false: the interesting default is a line the operator can still act on,
 * and a test about the committed head says so explicitly.
 */
export function lineupItem(overrides: Partial<LineupItem> = {}): LineupItem {
    return {
        id: 'line-1',
        pluginId: 'deadair.spotify',
        externalId: 'track-1',
        title: 'Windowlicker',
        artists: ['Aphex Twin'],
        durationMs: 366_000,
        committed: false,
        ...overrides,
    };
}

/** A lineup with three lines and nothing committed, which is a lineup that is not on air. */
export function lineup(overrides: Partial<Lineup> = {}): Lineup {
    return {
        id: 'lineup-1',
        name: 'Late shift',
        mode: 'rotation',
        onEnd: 'extend',
        source: 'import',
        revision: 4,
        cursor: 0,
        items: [
            lineupItem(),
            lineupItem({ id: 'line-2', externalId: 'track-2', title: 'Come to Daddy', durationMs: 250_000 }),
            lineupItem({ id: 'line-3', externalId: 'track-3', title: 'Xtal', durationMs: 293_000 }),
        ],
        ...overrides,
    };
}

/** The same lineup as a list shows it. */
export function lineupSummary(overrides: Partial<LineupSummary> = {}): LineupSummary {
    return {
        id: 'lineup-1',
        name: 'Late shift',
        mode: 'rotation',
        onEnd: 'extend',
        source: 'import',
        sourcePluginId: 'deadair.spotify',
        revision: 4,
        itemCount: 3,
        ...overrides,
    };
}

/** A station on air. What it is airing is its own running order, not a stored lineup. */
export function stationAir(overrides: Partial<StationAir> = {}): StationAir {
    return {
        active: true,
        name: 'Late shift',
        source: 'import',
        remaining: 2,
        ...overrides,
    };
}
