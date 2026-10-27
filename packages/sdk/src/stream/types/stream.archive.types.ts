import { DateTime } from 'luxon';
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * What a recording holds: a live show, or an hour of the station's own programme.
 * generated from [RecordingKind](../../../../../apps/api/data/contracts/stream/stream.archive.types.ck)
 */
export type RecordingKind = 'live' | 'hour';

/**
 * One file in the station's archive of what it aired.
 * generated from [Recording](../../../../../apps/api/data/contracts/stream/stream.archive.types.ck)
 */
export interface Recording {
    /** Names the recording, e.g. `2026-10-27T21-03-12-live` */
    id: string;
    kind: RecordingKind;
    /** The show's name, for a live show armed with one */
    title?: string;
    startedAt: DateTime;
    /** Absent while it is still being recorded */
    endedAt?: DateTime;
    bytes: number;
    /** Still being written. It cannot be deleted until it ends */
    recording: boolean;
    /** Where a player can stream it from, signed for a while so an audio element needs no token. Relative to the API */
    audioUrl: string;
}

export interface RecordingInput {}

/** Rehydrates every wire-encoded scalar in a Recording into its runtime type. Mutates and returns `raw`. */
export function reviveRecording(raw: Recording): Recording {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['startedAt'] = __dt(__o0['startedAt'], 'Recording.startedAt');
    if (__o0['endedAt'] != null) {
        __o0['endedAt'] = __dt(__o0['endedAt'], 'Recording.endedAt');
    }
    return raw;
}

/**
 * Every recording, newest first, and whether the station is recording at all.
 * generated from [RecordingList](../../../../../apps/api/data/contracts/stream/stream.archive.types.ck)
 */
export interface RecordingList {
    /** What the archive is set to keep */
    mode: 'off' | 'live' | 'all';
    /** How long a finished recording is kept. Zero keeps all of them */
    retentionDays: number;
    recordings: Recording[];
}

export interface RecordingListInput {
    recordings: RecordingInput[];
}

/** Rehydrates every wire-encoded scalar in a RecordingList into its runtime type. Mutates and returns `raw`. */
export function reviveRecordingList(raw: RecordingList): RecordingList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['recordings'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveRecording(__a1[__i2] as never);
        }
    }
    return raw;
}
