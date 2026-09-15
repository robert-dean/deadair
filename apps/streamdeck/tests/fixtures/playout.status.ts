import type { PlayoutItem, PlayoutStatus, SilenceCause, SilenceCheck, SilenceState } from '@deadair/sdk';

/** Every gate the station judges, in its order, each answering `ok` unless a test says otherwise. */
const GATES: SilenceCause[] = [
    'transportStalled',
    'controlDenied',
    'streamUnreachable',
    'configNotAdopted',
    'stoodDown',
    'noProgramme',
    'noAudience',
    'warmingUp',
    'waitingOnAudio',
    'notDriving',
    'starved',
];

function checks(states: Partial<Record<SilenceCause, SilenceState>>): SilenceCheck[] {
    return GATES.map(code => ({ code, state: states[code] ?? 'ok', detail: `${code} detail` }));
}

export const record: PlayoutItem = {
    id: 'item-1',
    pluginId: 'navidrome',
    externalId: 'ext-1',
    title: 'Pale Blue Eyes',
    artists: ['The Velvet Underground'],
    durationMs: 341_000,
    artworkUrl: 'art/5f0c1a52-6a37-4d5e-9d0e-2b7a1c0e9f11',
};

const base: PlayoutStatus = {
    streamUp: true,
    onAir: true,
    mountPath: '/live.mp3',
    mounts: [{ format: 'mp3', path: '/live.mp3', bitrateKbps: 192 }],
    upNext: [],
    queuedCount: 4,
    listeners: 1,
    audience: true,
    staleStreamConfig: [],
    silence: { audible: true, cause: 'airing', detail: 'On air.', checks: checks({}) },
};

/** A record airing, 200 seconds left of it. */
export function airing(overrides: Partial<PlayoutStatus> = {}): PlayoutStatus {
    return { ...base, nowPlaying: { item: record, startedAt: 1_000, remainingMs: 200_000 }, ...overrides };
}

/** Somebody pressed Stop. */
export function stoodDown(): PlayoutStatus {
    return {
        ...base,
        onAir: false,
        queuedCount: 0,
        silence: { audible: false, cause: 'stoodDown', detail: 'Stood down.', checks: checks({ stoodDown: 'waiting' }) },
    };
}

/** Stood down, and the stream cannot be reached either, which the station names as the cause because it is judged first. */
export function stoodDownAndUnreachable(): PlayoutStatus {
    return {
        ...base,
        streamUp: false,
        onAir: false,
        silence: {
            audible: false,
            cause: 'streamUnreachable',
            detail: 'The stream does not answer.',
            checks: checks({ streamUnreachable: 'fault', stoodDown: 'waiting' }),
        },
    };
}

/** An audience-gated station with nobody listening: ready, and quiet on purpose. */
export function waitingForListener(): PlayoutStatus {
    return {
        ...base,
        onAir: false,
        listeners: 0,
        audience: false,
        silence: { audible: false, cause: 'noAudience', detail: 'Nobody is listening.', checks: checks({ noAudience: 'waiting' }) },
    };
}
