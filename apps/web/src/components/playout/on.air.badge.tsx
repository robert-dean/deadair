import { Badge, Tooltip } from '@mantine/core';
import type { StationSilence } from '@deadair/sdk';

import { toneColor } from '../shared/status';
import { readSilence } from './silence.reading';

export interface OnAirBadgeProps {
    silence: StationSilence;
}

/**
 * The tally light: is this station broadcasting right now?
 *
 * It used to work the answer out here, from `streamUp`, `onAir`, `audience` and `queuedCount`. That
 * was three partial inferences across this file and `transport.bar.tsx`, and none of them could tell
 * apart the pair that matters most: an empty room and an Icecast that stopped answering are the same
 * listener count, and in `audience` mode the second one is permanent silence. The station names its
 * own cause now, and this only draws it.
 *
 * The cause-to-word mapping moved to `silence.reading.ts` when the header grew a tally of its own:
 * two copies of it is two places for "ready" to quietly become "off air" in one of them, which is
 * the pair the whole vocabulary exists to keep apart. The DRAWING stays here, because a badge and
 * the header's quiet pill want different emphasis from the same reading.
 *
 * Red for on air, which is the one convention every studio already shares.
 */
export function OnAirBadge({ silence }: OnAirBadgeProps) {
    const { tone, label, detail, live } = readSilence(silence);

    return (
        <Tooltip multiline w={340} label={detail}>
            <Badge variant={live ? 'filled' : 'light'} color={toneColor[tone]} className={live ? 'da-lamp-pulse' : undefined}>
                {label}
            </Badge>
        </Tooltip>
    );
}
