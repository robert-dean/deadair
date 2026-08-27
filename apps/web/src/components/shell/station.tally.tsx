import { Box, Group, Text, Tooltip } from '@mantine/core';
import type { PlayoutStatus } from '@deadair/sdk';

import { listenerLabel, readSilence } from '../playout/silence.reading';
import { StatusLamp } from '../shared/status.lamp';

export interface StationTallyProps {
    /**
     * The transport reading, or absent while the first poll has not landed.
     *
     * Absent draws NOTHING rather than a resting state. The tally is the one object on the console
     * an operator trusts without reading, so a pill claiming "off air" because a request is in
     * flight is worse than a gap where it will be.
     */
    status?: PlayoutStatus;
}

/**
 * Is the station on air, is anyone listening, and where — once, in the chrome.
 *
 * This reading was drawn in four places at the same time: a badge in the nav, the transport strip
 * across the footer, the On-air panel and a Check-up card. Four copies of one fact is four chances
 * to disagree, and on a console whose whole job is answering "is it out?" the disagreement is the
 * failure. It belongs in the chrome for the same reason a studio puts the tally over the door:
 * every page needs it and no page owns it.
 *
 * The three parts are deliberately one object rather than three. Whether audio is leaving the
 * building, whether anybody caught it and which mount it went to are separate facts that are only
 * ever read together — "on air, nobody listening" is a different situation from "ready", and both
 * are unreadable without knowing what is being asked.
 */
export function StationTally({ status }: StationTallyProps) {
    if (!status) return undefined;

    const reading = readSilence(status.silence);

    return (
        <Tooltip multiline w={340} label={reading.detail}>
            <Group
                gap="xs"
                wrap="nowrap"
                h={30}
                pl="xs"
                pr="sm"
                style={{
                    border: '1px solid var(--da-border-strong)',
                    borderRadius: 15,
                    background: 'var(--da-panel)',
                    flexShrink: 0,
                }}
            >
                <StatusLamp tone={reading.tone} label={reading.label} pulse={reading.live} />
                <TallyRule visibleFrom="xs" />
                {/* Dimmed at zero, because an empty room is not a fault and must not read as one.
                    In `audience` mode it is also the reason the station is quiet, which the lamp
                    beside it has already said in its own words.

                    No `.da-num` here, unlike most figures in the console: that class forces the
                    monospace FAMILY, which is for columns that have to line up. This is one count
                    inside a sentence, and `body` already carries `tabular-nums`, so the digit holds
                    its width as it ticks without dragging the face along with it. */}
                <Text size="xs" c={status.listeners > 0 ? undefined : 'dimmed'} visibleFrom="xs">
                    {listenerLabel(status.listeners)}
                </Text>
                <TallyRule visibleFrom="sm" />
                <Text size="xs" c="dimmed" ff="monospace" visibleFrom="sm">
                    {status.mountPath}
                </Text>
            </Group>
        </Tooltip>
    );
}

/**
 * A hairline between readings.
 *
 * Its own element rather than Mantine's `Divider`, which draws a rule across a stack rather than a
 * tick between two items on a row.
 *
 * `visibleFrom` is required rather than defaulted, and it takes the breakpoint of the reading that
 * FOLLOWS it: a rule is only a separator while there is something on the other side of it. Pinning
 * both to `xs` left a stray tick hanging off the end of the pill on a phone, where the mount had
 * already dropped out — a mark separating a figure from nothing.
 */
function TallyRule({ visibleFrom }: { visibleFrom: 'xs' | 'sm' }) {
    return <Box w={1} h={14} style={{ background: 'var(--da-border-strong)', flexShrink: 0 }} visibleFrom={visibleFrom} />;
}
