import { useEffect, useState } from 'react';
import { ActionIcon, Button, Divider, Group, Paper, Progress, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconHeadphones, IconPlayerPlay, IconPlayerSkipForward, IconPlayerStop } from '@tabler/icons-react';
import type { PlayoutStatus } from '@deadair/sdk';

import { useSetAirMode } from '../../api/director.queries';
import { useSkipCurrent, useStartPlayout, useStopPlayout } from '../../api/playout.queries';
import { Artwork } from '../shared/artwork';
import { TrackLink } from '../shared/catalog.links';
import { formatTimeOfDay } from '../shared/feed.moment';
import { formatDuration } from '../shared/format.duration';
import { listenerLabel, OnAirBadge } from './on.air.badge';
import { usePlayhead } from './playhead';
import { StaleConfigAlert, StaleConfigBadge } from './stale.config.alert';
import { TransportQueue } from './transport.queue';

export interface TransportBarProps {
    status: PlayoutStatus;
    /**
     * What the station is airing against: `audience` goes on air only while
     * somebody is listening, `always` whenever there is a programme. Absent while
     * the air reading has not arrived, which is not the same as `audience` — the
     * control draws nothing rather than a value nobody chose.
     */
    airMode?: 'audience' | 'always';
    /** Whether the full panel is open. Owned by the shell, which has to reserve the height. */
    expanded: boolean;
    onToggleExpanded: () => void;
    /**
     * When the reading behind `status` actually arrived, as epoch milliseconds.
     *
     * Optional because a caller that does not know claims nothing: with it absent the strip reads
     * exactly as it did, which is the right answer for a test render and for anything drawing a
     * status it did not poll for.
     */
    updatedAt?: number;
}

/** Footer heights the shell reserves, collapsed and expanded. */
export const TRANSPORT_HEIGHT = 56;
export const TRANSPORT_HEIGHT_EXPANDED = 280;

/** One size for every control on the strip, so the row reads as one instrument. */
const ICON = 17;

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
    // A container holding replaced config shows even on an idle station, and has to:
    // it is the reason an operator's next attempt to go on air will fail, and the bar
    // is the only place that says so. It is deliberately not the station's `cause` —
    // it never is one, because a station can air perfectly well while it is true.
    if (status.staleStreamConfig.length > 0) return true;

    // Anything the station has something to say about. `stoodDown` is the one silence
    // that is not worth a permanent strip: an operator who pressed Stop knows why it is
    // quiet, and a bar that stayed up to tell them would be one more thing to read on
    // every page.
    if (!status.silence.audible) return status.silence.cause !== 'stoodDown';

    // Airing, so show it while there is anything to show. The pair cannot both be empty
    // on a station the API calls audible, and checking anyway costs nothing: the bar is
    // laid out from this answer before the reading behind it is drawn.
    return status.nowPlaying !== undefined || status.queuedCount > 0;
}

/**
 * How long a reading may stand before the strip stops presenting it as the present tense.
 *
 * Five missed polls at the transport's two seconds. Long enough that an ordinary slow answer or a
 * request lost to a reload says nothing, short enough that an operator looking at a title is not
 * looking at one that stopped playing a minute ago. TanStack keeps the last successful data when a
 * poll fails, which is the right call — the alternative is a strip that blanks on every blip — and
 * this is the other half of it: the data stays and stops claiming to be now.
 */
const STALE_AFTER_MS = 10_000;

/** How often the check runs. It only has to notice within a beat of the threshold. */
const STALE_TICK_MS = 2_000;

/**
 * Whether the reading on screen is still current.
 *
 * A ticking check rather than a value derived at render, because nothing re-renders this strip when
 * a poll FAILS: the query keeps its last data, the component keeps its props, and without a clock of
 * its own the bar would go on presenting a dead reading indefinitely. Counted against the wall clock
 * rather than in ticks, unlike the playhead beside it, since the question here is how old a
 * timestamp is and a throttled tab that woke up late should say so rather than pretend it did not
 * sleep.
 */
function useStaleReading(updatedAt: number | undefined): boolean {
    // A ticking CLOCK rather than a ticking boolean. Deriving the answer at render keeps the effect
    // free of a synchronous setState, and keeps this one fact in one place: with a boolean the
    // threshold is applied in the effect and read in the body, so a change of mind about how old is
    // too old has two homes.
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => {
            setNow(Date.now());
        }, STALE_TICK_MS);

        return () => {
            clearInterval(timer);
        };
    }, []);

    return updatedAt !== undefined && now - updatedAt > STALE_AFTER_MS;
}

export function TransportBar({ status, airMode, expanded, onToggleExpanded, updatedAt }: TransportBarProps) {
    const skip = useSkipCurrent();
    const stop = useStopPlayout();
    const start = useStartPlayout();
    const setAirMode = useSetAirMode();
    const stale = useStaleReading(updatedAt);

    const { streamUp, nowPlaying, upNext, queuedCount, mountPath, listeners, silence } = status;
    const idle = !nowPlaying && queuedCount === 0;

    // Only when the decoder actually reported a position. A progress bar that
    // extrapolated from a start time would be a moving, confident lie.
    const playhead = usePlayhead(nowPlaying);

    return (
        <Paper
            radius={0}
            px="md"
            py="xs"
            h="100%"
            className="da-scanlines"
            // A heavier rule than a card's: this is the edge of the desk, and the strip below it
            // has to read as chrome rather than as one more panel in the page's stack.
            style={{ borderTop: '1px solid var(--da-border-strong)', background: 'var(--da-panel)' }}
        >
            <Stack gap="xs" h="100%">
                <Group justify="space-between" wrap="nowrap" gap="lg">
                    {/* Only while something is on air: an empty square over "Starting…" reads as a
                        second thing being wrong rather than as art the station does not have. */}
                    {nowPlaying ? <Artwork src={nowPlaying.item.artworkUrl} alt={nowPlaying.item.title} size={expanded ? 40 : 32} /> : undefined}
                    {/* Dimmed WHOLE rather than per line: what is stale is the reading, not one
                        field of it, and half a strip at full strength would read as the parts that
                        are still true. */}
                    <Stack gap="xxxs" style={{ minWidth: 0, flex: 1, opacity: stale ? 0.55 : 1 }}>
                        {nowPlaying ? (
                            <>
                                <Group gap="xs" wrap="nowrap">
                                    {/* The title alone is linked: the player is handed a copy and
                                        knows its canonical track, not which artist or release the
                                        catalog files it under. Only the title, and only when the
                                        catalog holds the record. */}
                                    <TrackLink id={nowPlaying.item.trackId} size="sm" fw={600} truncate>
                                        {nowPlaying.item.title}
                                    </TrackLink>
                                    <Text size="sm" c="dimmed" truncate>
                                        {nowPlaying.item.artists.join(', ')}
                                    </Text>
                                    {/* The one thing a dimmed strip cannot say on its own: WHEN it
                                        was true. Without the time this reads as a styling choice
                                        rather than as a reading that has stopped arriving. */}
                                    {stale && updatedAt !== undefined ? (
                                        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }} className="da-num">
                                            as of {formatTimeOfDay(new Date(updatedAt).toISOString())}
                                        </Text>
                                    ) : undefined}
                                    {/* The album earns its place only with the panel open. The strip
                                        sits under every page, and the title and artist are what
                                        identify a track. */}
                                    {expanded && nowPlaying.item.album ? (
                                        <Text size="xs" c="dimmed" truncate visibleFrom="sm">
                                            {nowPlaying.item.album}
                                            {nowPlaying.item.year ? ` (${nowPlaying.item.year})` : ''}
                                        </Text>
                                    ) : undefined}
                                </Group>
                                {playhead ? (
                                    <Group gap="xs" wrap="nowrap">
                                        {/* Tabular figures on both ends: these count while you watch them, and
                                            proportional digits make the whole row twitch on every tick. */}
                                        <Text size="xs" c="dimmed" className="da-num">
                                            {formatDuration(playhead.elapsedMs)}
                                        </Text>
                                        <Progress value={playhead.percent} size={4} radius={0} style={{ flex: 1 }} aria-label="Track progress" />
                                        <Text size="xs" c="dimmed" className="da-num">
                                            -{formatDuration(playhead.remainingMs)}
                                        </Text>
                                    </Group>
                                ) : undefined}
                            </>
                        ) : (
                            <Text size="sm" c="dimmed">
                                {/* Nothing on air, which is half a dozen different things and used to
                                    be guessed at from three fields. The station composes every gate
                                    and hands over the sentence, so this reads it rather than
                                    re-deriving a worse version of it.

                                    `Starting…` is what is left: audible, and the player has not named
                                    an item yet, which is the couple of seconds a fetch takes. */}
                                {silence.audible ? 'Starting…' : silence.detail}
                            </Text>
                        )}
                    </Stack>

                    <Group gap="sm" wrap="nowrap">
                        {/* Before the audience and the transport controls, because it outranks
                            both: while it is showing, the count is refusals rather than
                            listeners and the controls are driving a station nobody can reach. */}
                        <StaleConfigBadge warnings={status.staleStreamConfig} />

                        {/* The audience, in both states of the bar. It is what decides whether
                            any of this is audible, so it is not a statistic to bury in a panel
                            an operator has to open. */}
                        <Tooltip label="Clients attached to the mount, as Icecast counts them">
                            <Group gap="xxs" wrap="nowrap" visibleFrom="xs" c={listeners > 0 ? undefined : 'dimmed'}>
                                <IconHeadphones size={15} stroke={1.7} />
                                <Text size="xs" className="da-num" c={listeners > 0 ? undefined : 'dimmed'}>
                                    {listenerLabel(listeners)}
                                </Text>
                            </Group>
                        </Tooltip>

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
                                <IconPlayerSkipForward size={ICON} stroke={1.7} />
                            </ActionIcon>
                        </Tooltip>

                        {/* Only while the panel is shut: open, the same command is a
                            labelled button below, and two controls that do one thing is
                            one more thing to be sure about mid-broadcast. */}
                        {/* Only when there is nothing on air to stop, which is what makes the pair
                            unambiguous: one control is shown at a time and it is always the one
                            that does something. A stopped station keeps its running order, so this
                            resumes it rather than building a new one. */}
                        {!expanded && idle ? (
                            <Tooltip label="Put the station back on air on the running order it was stopped on">
                                <ActionIcon
                                    variant="subtle"
                                    aria-label="Start the station again"
                                    loading={start.isPending}
                                    onClick={() => start.mutate()}
                                >
                                    <IconPlayerPlay size={ICON} stroke={1.7} />
                                </ActionIcon>
                            </Tooltip>
                        ) : undefined}

                        {!expanded && !idle ? (
                            <Tooltip label="Take the station out of service: drop the running order and go quiet, whoever is listening">
                                <ActionIcon
                                    variant="subtle"
                                    color="red"
                                    aria-label="Take the station out of service"
                                    loading={stop.isPending}
                                    disabled={idle}
                                    onClick={() => stop.mutate()}
                                >
                                    <IconPlayerStop size={ICON} stroke={1.7} />
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
                                {expanded ? <IconChevronDown size={ICON} stroke={1.7} /> : <IconChevronUp size={ICON} stroke={1.7} />}
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                </Group>

                {expanded ? (
                    <>
                        <Divider />
                        <Stack gap="xs" style={{ minHeight: 0, flex: 1 }}>
                            {/* Above the running order: what is queued does not matter until
                                the container holding the mount is running the right secrets. */}
                            <StaleConfigAlert warnings={status.staleStreamConfig} />
                            <TransportQueue upNext={upNext} queuedCount={queuedCount} />
                            <Group gap="xs" mt="auto">
                                <OnAirBadge silence={status.silence} />
                                <Text size="xs" c="dimmed" ff="monospace">
                                    {mountPath}
                                </Text>

                                {/* What the mount lease is renewed against. A station setting
                                    rather than a transport command, but this is where an operator
                                    asks why nothing is going out, so it is where the answer
                                    belongs. */}
                                {airMode ? (
                                    <Tooltip label="Whether the station airs only while somebody is listening, or whenever it has something to play">
                                        <SegmentedControl
                                            size="xs"
                                            value={airMode}
                                            disabled={setAirMode.isPending}
                                            onChange={value => setAirMode.mutate({ airMode: value as 'audience' | 'always' })}
                                            data={[
                                                { value: 'audience', label: 'When listened to' },
                                                { value: 'always', label: 'Always on' },
                                            ]}
                                            aria-label="What puts the station on air"
                                        />
                                    </Tooltip>
                                ) : undefined}

                                {/* The icon's replacement while the panel is open: with room to
                                    say what it does, it says it. Not "stop playing" any more —
                                    the audience decides that. This is the station standing down,
                                    which is what silences it even with listeners attached. */}
                                {idle ? (
                                    <Button size="compact-xs" variant="subtle" ml="auto" loading={start.isPending} onClick={() => start.mutate()}>
                                        Start again
                                    </Button>
                                ) : (
                                    <Button
                                        size="compact-xs"
                                        variant="subtle"
                                        color="red"
                                        ml="auto"
                                        loading={stop.isPending}
                                        onClick={() => stop.mutate()}
                                    >
                                        Take out of service
                                    </Button>
                                )}
                            </Group>
                        </Stack>
                    </>
                ) : undefined}
            </Stack>
        </Paper>
    );
}
