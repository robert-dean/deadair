import { ActionIcon, Badge, Button, Divider, Group, Paper, Progress, Stack, Text, Tooltip } from '@mantine/core';
import type { PlayoutStatus } from '@deadair/sdk';

import { useSkipCurrent, useStopPlayout } from '../../api/playout.queries';
import { formatDuration } from '../shared/format.duration';
import { usePlayhead } from './playhead';
import { TransportQueue } from './transport.queue';

export interface TransportBarProps {
    status: PlayoutStatus;
    /** Whether the full panel is open. Owned by the shell, which has to reserve the height. */
    expanded: boolean;
    onToggleExpanded: () => void;
}

/** Footer heights the shell reserves, collapsed and expanded. */
export const TRANSPORT_HEIGHT = 56;
export const TRANSPORT_HEIGHT_EXPANDED = 280;

/**
 * Whether the station has anything worth a permanent strip across the console.
 *
 * Idle and reachable is the one state with nothing to say, and a bar that showed
 * it anyway would be one more thing to read on every page. Exported because the
 * shell has to know before it lays out: `AppShell` reserves the footer's height
 * whether or not its contents render, so the decision cannot live in the bar.
 */
export function hasTransportToShow(status: PlayoutStatus | undefined): status is PlayoutStatus {
    if (!status) return false;
    const idle = !status.nowPlaying && status.queuedCount === 0;
    return !idle || !status.streamUp;
}

/**
 * The station's transport.
 *
 * It reports what the PLAYER says is airing, which is a different thing from
 * what the app last handed over: an item is pushed, and downloaded, one item
 * ahead of air, so a bar driven by the hand-over would name the next track for
 * most of the current one.
 *
 * Two states, one component. Collapsed it is a strip: what is on air, how far in,
 * and the two commands. Expanded it adds the running order behind it and where
 * the stream is going. The collapsed strip is the resting state on purpose —
 * this sits under every page, and a console that permanently spends a third of
 * the window on the transport is worse at everything else.
 *
 * Presentational: the shell owns the polling AND the expanded flag, because it
 * also has to decide how much footer to reserve.
 */
export function TransportBar({ status, expanded, onToggleExpanded }: TransportBarProps) {
    const skip = useSkipCurrent();
    const stop = useStopPlayout();

    const { streamUp, nowPlaying, upNext, queuedCount, mountPath } = status;
    const idle = !nowPlaying && queuedCount === 0;

    // Only when the decoder actually reported a position. A progress bar that
    // extrapolated from a start time would be a moving, confident lie.
    const playhead = usePlayhead(nowPlaying);

    return (
        <Paper radius={0} px="lg" py="xs" h="100%" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
            <Stack gap="xs" h="100%">
                <Group justify="space-between" wrap="nowrap" gap="lg">
                    <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                        {nowPlaying ? (
                            <>
                                <Group gap="xs" wrap="nowrap">
                                    <Text size="sm" fw={600} truncate>
                                        {nowPlaying.item.title}
                                    </Text>
                                    <Text size="sm" c="dimmed" truncate>
                                        {nowPlaying.item.artists.join(', ')}
                                    </Text>
                                </Group>
                                {playhead ? (
                                    <Group gap="xs" wrap="nowrap">
                                        <Text size="xs" c="dimmed" ff="monospace">
                                            {formatDuration(playhead.elapsedMs)}
                                        </Text>
                                        <Progress value={playhead.percent} size="xs" style={{ flex: 1 }} aria-label="Track progress" />
                                        <Text size="xs" c="dimmed" ff="monospace">
                                            -{formatDuration(playhead.remainingMs)}
                                        </Text>
                                    </Group>
                                ) : undefined}
                            </>
                        ) : (
                            <Text size="sm" c="dimmed">
                                {/* Queued but not airing: either the player has been handed an item and
                                    is still fetching it, or nothing can start at all. */}
                                {streamUp ? 'Starting…' : 'The stream is not reachable, so nothing can go to air.'}
                            </Text>
                        )}
                    </Stack>

                    <Group gap="sm" wrap="nowrap">
                        {/* The next track is worth the width only while the panel is shut;
                            open, the whole order is right below it. */}
                        {!expanded && upNext.length > 0 ? (
                            <Text size="xs" c="dimmed" truncate maw={260} visibleFrom="sm">
                                Next: {upNext[0]?.title}
                                {queuedCount > 1 ? ` (+${queuedCount - 1} more)` : ''}
                            </Text>
                        ) : undefined}

                        <Tooltip label="Skip this track">
                            <ActionIcon
                                variant="subtle"
                                aria-label="Skip this track"
                                loading={skip.isPending}
                                // Nothing on air is nothing to cut, and a skip needs a stream to take it.
                                disabled={!streamUp || !nowPlaying}
                                onClick={() => skip.mutate()}
                            >
                                ⏭
                            </ActionIcon>
                        </Tooltip>

                        {/* Only while the panel is shut: open, the same command is a
                            labelled button below, and two controls that do one thing is
                            one more thing to be sure about mid-broadcast. */}
                        {!expanded ? (
                            <Tooltip label="Stop, and fall back to the local music bed">
                                <ActionIcon
                                    variant="subtle"
                                    color="red"
                                    aria-label="Stop playout"
                                    loading={stop.isPending}
                                    disabled={idle}
                                    onClick={() => stop.mutate()}
                                >
                                    ⏹
                                </ActionIcon>
                            </Tooltip>
                        ) : undefined}

                        <Tooltip label={expanded ? 'Hide the running order' : 'Show the running order'}>
                            <ActionIcon
                                variant="subtle"
                                aria-label={expanded ? 'Collapse the transport' : 'Expand the transport'}
                                aria-expanded={expanded}
                                onClick={onToggleExpanded}
                            >
                                {expanded ? '▾' : '▴'}
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                </Group>

                {expanded ? (
                    <>
                        <Divider />
                        <Stack gap="xs" style={{ minHeight: 0, flex: 1 }}>
                            <TransportQueue upNext={upNext} queuedCount={queuedCount} />
                            <Group gap="xs" mt="auto">
                                <Badge size="sm" variant="light" color={streamUp ? 'teal' : 'red'}>
                                    {streamUp ? 'Stream up' : 'Stream unreachable'}
                                </Badge>
                                <Text size="xs" c="dimmed" ff="monospace">
                                    {mountPath}
                                </Text>
                                {/* The icon's replacement while the panel is open: with room to
                                    say what it does, it says it. */}
                                <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    color="red"
                                    ml="auto"
                                    loading={stop.isPending}
                                    disabled={idle}
                                    onClick={() => stop.mutate()}
                                >
                                    Stop playout
                                </Button>
                            </Group>
                        </Stack>
                    </>
                ) : undefined}
            </Stack>
        </Paper>
    );
}
