import { useState } from 'react';
import { Box, Button, Card, Collapse, Group, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import type { PlayoutStatus, StationOrder } from '@deadair/sdk';

import { useStartPlayout, useStopPlayout, useSkipCurrent } from '../../api/playout.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { usePlayhead } from '../playout/playhead';
import { readSilence } from '../playout/silence.reading';
import { StaleConfigAlert } from '../playout/stale.config.alert';
import { Artwork } from '../shared/artwork';
import { TrackLink } from '../shared/catalog.links';
import { ErrorAlert } from '../shared/error.alert';
import { formatDuration } from '../shared/format.duration';
import { HostOnAir } from '../onair/host.on.air';

export interface OnAirNowProps {
    status: PlayoutStatus;
    /** The broadcast this is part of, for its name and its host. Absent while the order has not loaded. */
    order?: StationOrder;
    /** Whether the station has been stood down, which decides whether the second button starts or stops. */
    standingDown: boolean;
}

/**
 * What is going out, right now, at the top of the desk.
 *
 * This one panel replaces four surfaces that each told part of it: the tally badge on the old home
 * page, the transport strip across the footer, the On-air page's header, and the "On air" card on
 * Check-up. They did not disagree often, but they COULD, and on the console's landing screen the
 * question is always the same one — is it out, and what is it.
 *
 * The two controls are Skip and Stop, and they are here because the footer that used to carry them
 * is gone. That is the trade the footer was not worth: a strip under every page, reserving height on
 * Settings and the catalog, to carry two buttons that only mean anything while looking at what is on
 * air. Here they sit beside the thing they act on.
 *
 * "Why is it on air?" is shut by default. Seven gates all reporting fine is a wall of text answering
 * a question nobody asked while the station is working — and the moment it is worth reading is the
 * moment something is wrong, which is when the panel below draws itself open anyway.
 */
export function OnAirNow({ status, order, standingDown }: OnAirNowProps) {
    const [why, setWhy] = useState(false);
    const skip = useSkipCurrent();
    const stop = useStopPlayout();
    const start = useStartPlayout();

    const { nowPlaying, upNext, queuedCount, silence } = status;
    const reading = readSilence(silence);
    const playhead = usePlayhead(nowPlaying);

    // Named actions sharing one stack, rather than each hiding in the tooltip of the button that
    // asked for it: a tooltip is hover-only, so a failure on the console's landing page would be
    // invisible to somebody looking straight at it.
    const failures = [
        skip.isError ? apiErrorMessage(skip.error, 'That track could not be skipped.') : undefined,
        stop.isError ? apiErrorMessage(stop.error, 'The station could not be stopped.') : undefined,
        start.isError ? apiErrorMessage(start.error, 'The station could not be put back on air.') : undefined,
    ].filter((message): message is string => message !== undefined);

    return (
        <Stack gap="sm">
            <Card
                withBorder
                padding="lg"
                // The tally rule along the top edge, in the one colour that means ON AIR on a desk.
                // Dimmed to the border's own weight when it is not: a red rule over a stood-down
                // station is the single most misleading mark this console could make.
                style={{ borderTop: `2px solid ${reading.live ? 'var(--mantine-color-red-6)' : 'var(--da-border)'}` }}
            >
                <Group align="flex-start" wrap="nowrap" gap="lg">
                    {/* Only while there is something on air. An empty square beside "waiting for a
                        listener" reads as a second thing being wrong rather than as art the station
                        does not have — and the station is most often idle at exactly the moment an
                        operator opens the console to check nothing is broken. */}
                    {nowPlaying ? <Artwork src={nowPlaying.item.artworkUrl} alt={nowPlaying.item.title} size={88} /> : undefined}

                    <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="sm" wrap="nowrap">
                            <Text
                                size="xs"
                                fw={600}
                                tt="uppercase"
                                ff="monospace"
                                c={reading.live ? 'red.3' : 'dimmed'}
                                style={{ letterSpacing: 'var(--da-tracking-eyebrow)', whiteSpace: 'nowrap' }}
                                className={reading.live ? 'da-lamp-pulse' : undefined}
                            >
                                {reading.live ? 'On air now' : reading.label}
                            </Text>
                            {order ? (
                                <Group gap="xxs" wrap="nowrap" style={{ minWidth: 0 }}>
                                    <Text size="sm" c="dimmed" truncate>
                                        {order.name}
                                    </Text>
                                    {/* A control rather than a label, and the only place a show's
                                        presenter can be changed without starting a new broadcast. */}
                                    <HostOnAir
                                        {...(order.personaId === undefined ? {} : { personaId: order.personaId })}
                                        {...(order.personaLabel === undefined ? {} : { personaLabel: order.personaLabel })}
                                    />
                                </Group>
                            ) : undefined}
                        </Group>

                        {nowPlaying ? (
                            <Group gap="sm" align="baseline" wrap="nowrap" style={{ minWidth: 0 }}>
                                {/* Only the title is linked: the player is handed a copy and knows
                                    its canonical track, not which artist the catalog files it under. */}
                                <TrackLink id={nowPlaying.item.trackId} fz={24} ff="heading" fw={600} truncate>
                                    {nowPlaying.item.title}
                                </TrackLink>
                                <Text c="dimmed" truncate>
                                    {nowPlaying.item.artists.join(', ')}
                                </Text>
                            </Group>
                        ) : (
                            <Text c="dimmed">{silence.audible ? 'Starting…' : silence.detail}</Text>
                        )}

                        {playhead ? (
                            <Group gap="xs" wrap="nowrap">
                                <Text size="xs" c="dimmed" className="da-num">
                                    {formatDuration(playhead.elapsedMs)}
                                </Text>
                                <Progress value={playhead.percent} size={6} radius="xl" style={{ flex: 1 }} aria-label="Track progress" />
                                <Text size="xs" c="dimmed" className="da-num">
                                    -{formatDuration(playhead.remainingMs)}
                                </Text>
                            </Group>
                        ) : undefined}

                        {upNext.length > 0 ? (
                            <Group gap="xs" wrap="wrap">
                                <Text size="sm" c="dimmed">
                                    Up next
                                </Text>
                                {upNext.slice(0, 3).map((item, index) => (
                                    <Group key={item.id} gap="xs" wrap="nowrap">
                                        {index === 0 ? undefined : <Box w={4} h={4} bg="dark.4" style={{ borderRadius: '50%' }} />}
                                        <Text size="sm" c="dimmed.2">
                                            {item.title}
                                        </Text>
                                    </Group>
                                ))}
                                {queuedCount > 3 ? (
                                    <Text size="sm" c="dimmed">
                                        · {queuedCount - 3} to come
                                    </Text>
                                ) : undefined}
                            </Group>
                        ) : undefined}
                    </Stack>

                    <Stack gap="xs" w={172} style={{ flexShrink: 0 }}>
                        <Group gap="xs" grow wrap="nowrap">
                            <Tooltip label="Ends the track on air. The next one starts immediately.">
                                <Button
                                    variant="default"
                                    h={44}
                                    loading={skip.isPending}
                                    // Nothing on air is nothing to cut, and a skip needs a stream to take it.
                                    disabled={!status.streamUp || !nowPlaying}
                                    onClick={() => skip.mutate()}
                                >
                                    Skip
                                </Button>
                            </Tooltip>
                            {standingDown ? (
                                <Tooltip label="Puts the station back on air on the running order it was stopped on. Nothing is rebuilt." multiline maw={320}>
                                    <Button h={44} loading={start.isPending} onClick={() => start.mutate()}>
                                        Start
                                    </Button>
                                </Tooltip>
                            ) : (
                                <Tooltip
                                    label="Ends the broadcast. What is playing stops too, and the mount goes quiet rather than falling back to a bed."
                                    multiline
                                    maw={320}
                                >
                                    <Button color="red" variant="outline" h={44} loading={stop.isPending} onClick={() => stop.mutate()}>
                                        Stop
                                    </Button>
                                </Tooltip>
                            )}
                        </Group>
                        <Button
                            variant="subtle"
                            color="gray"
                            size="compact-sm"
                            rightSection={why ? <IconChevronUp size={14} stroke={1.8} /> : <IconChevronDown size={14} stroke={1.8} />}
                            onClick={() => setWhy(open => !open)}
                            aria-expanded={why}
                        >
                            Why is it on air?
                        </Button>
                    </Stack>
                </Group>
            </Card>

            {/* Outside the card and always drawn, unlike the gates: a container running replaced
                config is the reason the operator's NEXT attempt to go on air will fail, and it is
                deliberately never the station's own cause because it can air perfectly well while
                it is true. It would be invisible behind a disclosure. */}
            <StaleConfigAlert warnings={status.staleStreamConfig} />

            {failures.map(message => (
                <ErrorAlert key={message}>{message}</ErrorAlert>
            ))}

            <Collapse expanded={why}>
                <Card withBorder padding="md">
                    <Stack gap="sm">
                        <Text size="sm" c="dimmed">
                            {silence.detail}
                        </Text>
                        {/* Two columns, because seven gates in one column is a scroll on the panel
                            that is supposed to be a glance. */}
                        <Box
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                                columnGap: 'var(--mantine-spacing-lg)',
                                rowGap: 4,
                            }}
                        >
                            {silence.checks.map(check => (
                                <Group key={check.code} gap="xs" wrap="nowrap" align="flex-start">
                                    <Box
                                        w={6}
                                        h={6}
                                        mt={7}
                                        bg={check.state === 'ok' ? 'teal.4' : check.state === 'waiting' ? 'blue.4' : 'yellow.4'}
                                        style={{ borderRadius: '50%', flexShrink: 0 }}
                                    />
                                    <Text size="xs" c="dimmed" style={{ minWidth: 0 }}>
                                        {check.detail}
                                    </Text>
                                </Group>
                            ))}
                        </Box>
                    </Stack>
                </Card>
            </Collapse>
        </Stack>
    );
}
