import { Badge, Tooltip } from '@mantine/core';
import type { SilenceCause, StationSilence } from '@deadair/sdk';

import { type StatusTone, toneColor } from '../shared/status';

export interface OnAirBadgeProps {
    silence: StationSilence;
}

/**
 * The tally light: is this station broadcasting right now?
 *
 * It used to work the answer out here, from `streamUp`, `onAir`, `audience` and
 * `queuedCount`. That was three partial inferences across this file and
 * `transport.bar.tsx`, and none of them could tell apart the pair that matters
 * most: an empty room and an Icecast that stopped answering are the same
 * listener count, and in `audience` mode the second one is permanent silence.
 * The station names its own cause now, and this only draws it.
 *
 * The states worth keeping visually distinct are the ones that look alike. The
 * stream being REACHABLE is not the station being ON AIR, and neither of those
 * is "ready", which is the state this console had no word for: loaded, up, and
 * waiting for a listener. It is not a fault and it is not off, and saying so is
 * the difference between a console that looks broken and one that is waiting.
 *
 * Red for on air, which is the one convention every studio already shares.
 */
export function OnAirBadge({ silence }: OnAirBadgeProps) {
    if (silence.audible) {
        return (
            <Tooltip label={silence.detail}>
                <Badge variant="filled" color={toneColor.live} className="da-lamp-pulse">
                    on air
                </Badge>
            </Tooltip>
        );
    }

    const blocking = silence.checks.find(check => check.code === silence.cause);
    const tone = blocking?.state === 'waiting' ? (WAITING_TONES[silence.cause] ?? 'standby') : 'fault';
    return (
        <Tooltip multiline w={340} label={silence.detail}>
            <Badge variant="light" color={toneColor[tone]}>
                {LABELS[silence.cause]}
            </Badge>
        </Tooltip>
    );
}

/**
 * Two words per gate, for a badge that sits under every page.
 *
 * The SENTENCE comes from the station rather than from here, and this is only its
 * label — which is why there is no wording in this file that could disagree with
 * what the tooltip says.
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
    // station getting ready and the one below it is the station stuck, and the badge is the surface
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
 * Standby for waiting on a listener, because it is the resting state of an
 * audience-gated station and the operator has nothing to do about it. Off for
 * stood down, because they did it on purpose.
 *
 * Partial rather than exhaustive on purpose: anything the diagnosis calls
 * `waiting` falls back to standby, so a gate added there is drawn correctly here
 * without this file having to hear about it. `warmingUp` is the first one to
 * arrive that way.
 */
const WAITING_TONES: Partial<Record<SilenceCause, StatusTone>> = {
    noAudience: 'standby',
    stoodDown: 'off',
};

/**
 * How many people are listening, as a line of text.
 *
 * Its own export rather than part of the badge: the count is worth showing in
 * both states of the transport, and it means something different from the tally
 * light. The badge says whether audio is leaving the building; this says whether
 * anyone caught it.
 */
export function listenerLabel(listeners: number): string {
    if (listeners === 0) return 'nobody listening';
    return listeners === 1 ? '1 listening' : `${listeners} listening`;
}
