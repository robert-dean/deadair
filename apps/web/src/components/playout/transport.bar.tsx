import { ActionIcon, Group, Paper, Progress, Stack, Text, Tooltip } from '@mantine/core';
import type { PlayoutStatus } from '@deadair/sdk';

import { useSkipCurrent, useStopPlayout } from '../../api/playout.queries';
import { formatDuration } from '../shared/format.duration';

export interface TransportBarProps {
    status: PlayoutStatus;
}

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
 * Presentational: the shell owns the polling, because it also has to decide
 * whether to reserve the footer at all.
 */
export function TransportBar({ status }: TransportBarProps) {
    const skip = useSkipCurrent();
    const stop = useStopPlayout();

    const { streamUp, nowPlaying, upNext, queuedCount } = status;
    const idle = !nowPlaying && queuedCount === 0;

    // Only when the decoder actually reported a position. A progress bar that
    // extrapolated from a start time would be a moving, confident lie.
    const durationMs = nowPlaying?.item.durationMs;
    const remainingMs = nowPlaying?.remainingMs;
    const measured = durationMs !== undefined && remainingMs !== undefined && durationMs > 0;
    const progress = measured ? ((durationMs - remainingMs) / durationMs) * 100 : 0;

    return (
        <Paper radius={0} px="lg" py="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
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
                            {measured ? (
                                <Group gap="xs" wrap="nowrap">
                                    <Progress value={progress} size="xs" style={{ flex: 1 }} aria-label="Track progress" />
                                    <Text size="xs" c="dimmed" ff="monospace">
                                        -{formatDuration(remainingMs)}
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
                    {upNext.length > 0 ? (
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
                </Group>
            </Group>
        </Paper>
    );
}
