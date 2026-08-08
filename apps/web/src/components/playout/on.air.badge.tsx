import { Badge, Tooltip } from '@mantine/core';
import type { PlayoutStatus } from '@deadair/sdk';

export interface OnAirBadgeProps {
    status: PlayoutStatus;
}

/**
 * The tally light: is this station broadcasting right now?
 *
 * Four states, because there are four, and the ones worth telling apart are the
 * ones that look alike. The stream being REACHABLE is not the station being ON
 * AIR: deadair holds the mount on a lease it renews only while it has a
 * programme and somebody to hear it, so a perfectly healthy Liquidsoap with a
 * full running order is up, connected, and airing silence to an empty room.
 * Collapsing that into one light is how an operator ends up believing they are
 * broadcasting when they are not, or reading a working station as a broken one.
 *
 * "Ready" is the state this console had no word for. It is not a fault and it is
 * not off: the station is loaded, the stream is up, and the only thing missing
 * is a listener. Saying so is the difference between a console that looks broken
 * and one that is waiting.
 *
 * Red for on air, which is the one convention every studio already shares.
 */
export function OnAirBadge({ status }: OnAirBadgeProps) {
    if (!status.streamUp) {
        return (
            <Tooltip label="Liquidsoap's control API is not answering, so nothing can go to air whatever is queued">
                <Badge variant="light" color="yellow">
                    stream unreachable
                </Badge>
            </Tooltip>
        );
    }

    if (!status.onAir) {
        // Something to play and nobody to play it to: the ordinary resting state of an
        // audience-gated station, and the one an operator must not read as a failure.
        const waiting = !status.audience && (status.queuedCount > 0 || !!status.nowPlaying);
        if (waiting) {
            return (
                <Tooltip label="The station is loaded and the stream is up. It goes on air the moment somebody starts listening">
                    <Badge variant="light" color="blue">
                        ready
                    </Badge>
                </Tooltip>
            );
        }

        return (
            <Tooltip label="The stream is reachable, but deadair is not driving it: the mount is connected and airing silence">
                <Badge variant="light" color="gray">
                    off air
                </Badge>
            </Tooltip>
        );
    }

    return (
        <Tooltip label="deadair is holding the mount and its programme is going out">
            <Badge variant="filled" color="red">
                on air
            </Badge>
        </Tooltip>
    );
}

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
