import type { PlayoutItem, PlayoutStatus, SilenceCause, SilenceCheck, StationSilence } from '@deadair/sdk';

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

/** The gates the station judges, in the order it judges them. */
const GATES: SilenceCause[] = [
    'transportStalled',
    'streamUnreachable',
    'configNotAdopted',
    'stoodDown',
    'noProgramme',
    'noAudience',
    'notDriving',
    'starved',
];

/**
 * The station's answer to "why can't I hear anything", with one gate blocking.
 *
 * Built here rather than hand-written per test because the console must not
 * re-derive any of it: the whole point of the field is that the ordering lives on
 * the API side, so a fixture that let a test state a cause and a contradictory
 * set of checks would be testing a reading the station cannot produce.
 */
export function stationSilence(cause: SilenceCause = 'airing', overrides: Partial<StationSilence> = {}): StationSilence {
    const checks: SilenceCheck[] = GATES.map(code => ({
        code,
        state: code === cause ? (WAITING.includes(code) ? 'waiting' : 'fault') : 'ok',
        detail: code === cause ? DETAILS[code] : `${code} is fine.`,
    }));

    return {
        audible: cause === 'airing',
        cause,
        detail: DETAILS[cause],
        checks,
        ...overrides,
    };
}

/** The two gates that are not faults. See the badge, which colours them differently. */
const WAITING: SilenceCause[] = ['stoodDown', 'noAudience'];

/** Roughly what the station says, so a test asserting on the strip's sentence has something real. */
const DETAILS: Record<SilenceCause, string> = {
    airing: 'The station is holding the mount and its programme is going out.',
    transportStalled: 'The loop that renews the mount lease has not completed a pass for 60s.',
    controlDenied: 'The stream is answering and refusing us, so the mount lease cannot be renewed.',
    streamUnreachable: "Liquidsoap's control API is not answering, so nothing can go to air whatever the running order holds.",
    configNotAdopted: 'icecast is running config the app has replaced.',
    stoodDown: 'The station was stood down, so it is holding nothing and airing nothing.',
    noProgramme: 'The station is active but has nothing left to air.',
    noAudience: 'The station is loaded and the stream is up. It goes on air the moment somebody starts listening.',
    notDriving: 'There is a programme, an audience and a reachable stream, and deadair is still not holding the mount.',
    starved: "The mount has been airing Liquidsoap's local bed instead of the running order for 30s.",
};

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
        // On air means somebody is hearing it: the mount lease is only renewed while
        // there is an audience, so a fixture with listeners at zero is a contradiction
        // unless a test is deliberately staging one.
        listeners: 1,
        audience: true,
        // Both containers running the config that was rendered for them, which is the
        // ordinary state. A test staging drift passes its own.
        staleStreamConfig: [],
        // Composed by the API from every gate at once. A test staging a silence passes
        // `stationSilence('<cause>')` rather than setting the fields it is derived from,
        // because the console no longer derives it from them.
        silence: stationSilence(),
        ...overrides,
    };
}
