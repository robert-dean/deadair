import type { PlayoutItem, PlayoutStatus } from '@deadair/sdk';

/** One item in the running order. `id` is deadair's own, not the provider's. */
export function playoutItem(overrides: Partial<PlayoutItem> = {}): PlayoutItem {
    return {
        id: 'item-1',
        pluginId: 'deadair.spotify',
        externalId: 'track-1',
        title: 'Windowlicker',
        artists: ['Aphex Twin'],
        durationMs: 366_000,
        ...overrides,
    };
}

/**
 * A station on air with something queued behind it.
 *
 * `remainingMs` is present by default because the measured case is the
 * interesting one: the console shows a clock only when the decoder actually said,
 * and a test that leaves it out is testing the other branch.
 */
export function playoutStatus(overrides: Partial<PlayoutStatus> = {}): PlayoutStatus {
    return {
        streamUp: true,
        onAir: true,
        mountPath: '/live.mp3',
        nowPlaying: {
            item: playoutItem(),
            startedAt: 1_700_000_000_000,
            remainingMs: 120_000,
        },
        upNext: [playoutItem({ id: 'item-2', externalId: 'track-2', title: 'Come to Daddy', durationMs: 250_000 })],
        queuedCount: 1,
        ...overrides,
    };
}
