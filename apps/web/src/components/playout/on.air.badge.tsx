import { Badge, Tooltip } from '@mantine/core';
import type { PlayoutStatus } from '@deadair/sdk';

export interface OnAirBadgeProps {
    status: PlayoutStatus;
}

/**
 * The tally light: is this station broadcasting right now?
 *
 * Three states, because there are three, and the two that look alike are the ones
 * worth telling apart. The stream being REACHABLE is not the station being ON
 * AIR: deadair holds the mount on a lease it renews only while it has a
 * programme, so a perfectly healthy Liquidsoap with nothing driving it is up,
 * connected, and airing silence. Collapsing that into one green light is how an
 * operator ends up believing they are broadcasting when they are not.
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
