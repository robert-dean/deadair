import type { SilenceCause, StationSilence } from '@deadair/sdk';

import type { StatusTone } from '../shared/status';

/**
 * Whether the station is on air, as a tone and a word.
 *
 * Its own module rather than part of the badge that first drew it, because the console now asks
 * this question from two places at once: the header's tally, which is on every page, and whatever
 * panel is currently reporting the broadcast. Two copies of the mapping below is two places for
 * "ready" to quietly become "off air" in one of them, which is exactly the pair this vocabulary
 * exists to keep apart.
 *
 * Nothing here works the answer OUT. The station composes every gate and names its own cause; this
 * turns that cause into something drawable and does not second-guess it.
 */
export interface SilenceReading {
    tone: StatusTone;
    label: string;
    /** The station's own sentence. Never rewritten here, only carried. */
    detail: string;
    /** Audio is genuinely leaving the building, which is the only thing allowed to pulse. */
    live: boolean;
}

export function readSilence(silence: StationSilence): SilenceReading {
    if (silence.audible) {
        return { tone: 'live', label: 'on air', detail: silence.detail, live: true };
    }

    const blocking = silence.checks.find(check => check.code === silence.cause);
    const tone: StatusTone = blocking?.state === 'waiting' ? (WAITING_TONES[silence.cause] ?? 'standby') : 'fault';

    return { tone, label: LABELS[silence.cause], detail: silence.detail, live: false };
}

/**
 * Two words per gate, for a reading that sits under every page.
 *
 * The SENTENCE comes from the station rather than from here, and this is only its label — which is
 * why there is no wording in this file that could disagree with what the detail says.
 */
const LABELS: Record<SilenceCause, string> = {
    airing: 'on air',
    transportStalled: 'transport stalled',
    controlDenied: 'stream refusing us',
    streamUnreachable: 'stream unreachable',
    configNotAdopted: 'config not adopted',
    stoodDown: 'off air',
    noProgramme: 'nothing to air',
    // "warming up" and not "fetching records", which is the sentence next door: this one is the
    // station getting ready and the one below it is the station stuck, and the tally is the surface
    // with the least room to explain which.
    warmingUp: 'warming up',
    waitingOnAudio: 'records not here',
    noAudience: 'ready',
    notDriving: 'not driving',
    starved: 'off the running order',
};

/**
 * Overrides for the states that are not faults and must not be drawn as one.
 *
 * Standby for waiting on a listener, because it is the resting state of an audience-gated station
 * and the operator has nothing to do about it. Off for stood down, because they did it on purpose.
 *
 * Partial rather than exhaustive on purpose: anything the diagnosis calls `waiting` falls back to
 * standby, so a gate added there is drawn correctly here without this file having to hear about it.
 */
const WAITING_TONES: Partial<Record<SilenceCause, StatusTone>> = {
    noAudience: 'standby',
    stoodDown: 'off',
};

/**
 * How many people are listening, as a line of text.
 *
 * It means something different from the tally light beside it. The lamp says whether audio is
 * leaving the building; this says whether anyone caught it.
 */
export function listenerLabel(listeners: number): string {
    if (listeners === 0) return 'nobody listening';
    return listeners === 1 ? '1 listening' : `${listeners} listening`;
}
