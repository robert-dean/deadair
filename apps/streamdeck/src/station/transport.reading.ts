import type { PlayoutStatus, SilenceCause, StationSilence } from '@deadair/sdk';

/**
 * How the station is doing, as a tone. The console's five (`components/shared/status.ts`): `live` is
 * audio leaving the building and the only one allowed to look urgent, `standby` is waiting on a
 * listener, `off` is stood down on purpose, and `fault` is something to go and fix.
 */
export type Tone = 'live' | 'standby' | 'off' | 'fault';

/** The transport, as the keys read it. */
export interface Transport {
    /** Audio is reaching the mount: the station's own `audible`, which is not the same as `onAir`. */
    live: boolean;
    /**
     * Somebody stood the station down, so Stop has nothing to stop and Start has something to resume.
     *
     * Read from the `stoodDown` GATE rather than from the cause. The gates are judged in order and a
     * stream that cannot be reached is judged first, so a station that is stood down AND unreachable
     * names the second as its cause while the first is still true. The check itself is always there:
     * the diagnosis builds every gate on every reading.
     */
    stoodDown: boolean;
    /** Whether Skip has anything to end. The console's own gate: a stream that answers and a record on it. */
    canSkip: boolean;
    tone: Tone;
    /** Two words for when there is no record to show. */
    label: string;
}

export function readTransport(status: PlayoutStatus): Transport {
    const stoodDown = status.silence.checks.some(check => check.code === 'stoodDown' && check.state !== 'ok');
    return {
        live: status.silence.audible,
        stoodDown,
        canSkip: status.streamUp && status.nowPlaying !== undefined,
        tone: toneOf(status.silence),
        label: status.silence.audible ? 'on air' : LABELS[status.silence.cause],
    };
}

/**
 * The console's tone for a silence (`components/playout/silence.reading.ts`), repeated rather than
 * imported because `apps/web` is an application and not a package. Nothing here works the answer
 * out: the station composes every gate and names its own cause, and this only draws it.
 */
function toneOf(silence: StationSilence): Tone {
    if (silence.audible) return 'live';
    const blocking = silence.checks.find(check => check.code === silence.cause);
    return blocking?.state === 'waiting' ? (WAITING_TONES[silence.cause] ?? 'standby') : 'fault';
}

/** Standby for waiting on a listener, off for a station somebody stood down. Anything else waiting is standby. */
const WAITING_TONES: Partial<Record<SilenceCause, Tone>> = {
    noAudience: 'standby',
    stoodDown: 'off',
};

/**
 * Two words per gate, the console's own, copied from `silence.reading.ts` so the key and the
 * console's tally never call one state by two names. A `Record` over the SDK's union, so a gate
 * added to the station fails this file's type check until it has a label.
 */
const LABELS: Record<SilenceCause, string> = {
    airing: 'on air',
    transportStalled: 'transport stalled',
    controlDenied: 'stream refusing us',
    streamUnreachable: 'stream unreachable',
    configNotAdopted: 'config not adopted',
    stoodDown: 'off air',
    noProgramme: 'nothing to air',
    warmingUp: 'warming up',
    waitingOnAudio: 'records not here',
    noAudience: 'ready',
    notDriving: 'not driving',
    starved: 'off the running order',
};
