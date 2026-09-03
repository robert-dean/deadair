import { useCallback, useEffect, useRef, useState } from 'react';
import { Anchor, Badge, Box, Button, Card, Collapse, Group, Progress, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import type { PlayoutStatus, StationOrder } from '@deadair/sdk';

import { useHoldAgainstSchedule, useSetAirMode } from '../../api/director.queries';
import { useStartPlayout, useStopPlayout, useSkipCurrent } from '../../api/playout.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { usePlayhead } from '../playout/playhead';
import { SilenceDiagnosisPanel } from '../playout/silence.diagnosis.panel';
import { readSilence } from '../playout/silence.reading';
import { StaleConfigAlert } from '../playout/stale.config.alert';
import { Artwork } from '../shared/artwork';
import { TrackLink } from '../shared/catalog.links';
import { ErrorAlert } from '../shared/error.alert';
import { formatDuration } from '../shared/format.duration';
import { usePhone } from '../shared/use.phone';
import { HostOnAir } from '../onair/host.on.air';

export interface OnAirNowProps {
    status: PlayoutStatus;
    /** The broadcast this is part of, for its name and its host. Absent while the order has not loaded. */
    order?: StationOrder;
    /** Whether the station has been stood down, which decides whether the second button starts or stops. */
    standingDown: boolean;
    /**
     * What the station is airing against: `audience` goes on air only while somebody is listening,
     * `always` whenever there is a programme. Absent while the air reading has not arrived, which is
     * not the same as `audience` — the control draws nothing rather than a value nobody chose.
     */
    airMode?: 'audience' | 'always';
    /**
     * Who is driving the station: the clock, or a person.
     *
     * Absent while the air reading has not arrived. It is derived by the API rather than compared
     * here, because a broadcast sustaining a GAP and one an operator started during that same gap
     * both belong to no slot, so the console cannot tell them apart from the schedule alone.
     */
    airSource?: 'off' | 'schedule' | 'sustaining' | 'operator';
    /** Whether the schedule has been told to leave this broadcast alone. */
    held?: boolean;
    /**
     * When that hold lapses, as an ISO-8601 instant.
     *
     * Absent WHILE {@link held} is true is the hold that never lapses, which is a real state rather
     * than a missing value: `Infinity` is not something JSON carries, so the two facts are two
     * fields. Absent with `held` false is simply no hold.
     */
    holdUntil?: string;
}

/** How long an armed Stop stays armed before it forgets, in ms. */
const STOP_ARMED_MS = 5_000;

/**
 * Stop, held one press away from firing.
 *
 * It is the only control on this console that takes the station off air, and it sits ten pixels
 * from Skip, which ends one record — two buttons of the same size, one recoverable and one heard by
 * everybody listening. A confirm dialog is the ordinary answer and is the wrong one here: this
 * surface is used with a thumb from bed as often as with a mouse, and a modal over a 44px control
 * is a second target to find rather than a moment to think.
 *
 * So the button arms itself instead, and says so by changing what it is called. It disarms on its
 * own, because a Stop left armed on a console nobody is looking at is a Stop that fires on the next
 * stray press — which is the thing this exists to prevent, arriving a minute later.
 */
function useArmedStop(fire: () => void) {
    const [armed, setArmed] = useState(false);
    const timer = useRef<number | undefined>(undefined);

    const disarm = useCallback(() => {
        window.clearTimeout(timer.current);
        timer.current = undefined;
        setArmed(false);
    }, []);

    useEffect(
        () => () => {
            window.clearTimeout(timer.current);
        },
        [],
    );

    return {
        armed,
        press: () => {
            if (armed) {
                disarm();
                fire();
                return;
            }
            setArmed(true);
            timer.current = window.setTimeout(disarm, STOP_ARMED_MS);
        },
    };
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
 *
 * Of the three controls only Stop asks twice — see {@link useArmedStop}. Skip ends one record and
 * Start puts a station back on air, and neither is a press worth a second thought.
 */
export function OnAirNow({ status, order, standingDown, airMode, airSource, held = false, holdUntil }: OnAirNowProps) {
    const hold = useHoldAgainstSchedule();
    const [why, setWhy] = useState(false);
    const skip = useSkipCurrent();
    const stop = useStopPlayout();
    const start = useStartPlayout();
    const setAirMode = useSetAirMode();
    const stopping = useArmedStop(() => stop.mutate());

    const { nowPlaying, upNext, queuedCount, silence } = status;
    const reading = readSilence(silence);
    const playhead = usePlayhead(nowPlaying);
    const phone = usePhone();

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
                {/* On a phone the row is allowed to wrap, and the transport goes full-width below —
                    88px of art plus 214px of controls is more than a 375px viewport holds, and of
                    the three things here the transport is the one that works at any width. */}
                <Group align="flex-start" wrap={phone ? 'wrap' : 'nowrap'} gap="lg">
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

                        {/* Shown rather than only accepted, because it is still WORKING: every
                            refill for the rest of this broadcast is programmed against it, so an
                            operator wondering why the station keeps choosing what it chooses is
                            looking at the answer. It had a badge on the old On-air page and this
                            panel replaced that page without it, which made a live instruction
                            invisible. */}
                        {/* Who chose this. The console has always been able to say WHAT is on and
                            never who put it there, and with a schedule running those are different
                            questions: an operator's own choice holds until the next block begins,
                            so "the clock is driving" and "you are" can each be true for an hour at
                            a time with nothing on the screen distinguishing them. */}
                        {airSource && airSource !== 'off' ? (
                            <Tooltip multiline maw={360} label={drivingLabel(airSource)}>
                                <Badge
                                    size="sm"
                                    variant="light"
                                    color={airSource === 'operator' ? 'orange' : 'gray'}
                                    tt="none"
                                    style={{ alignSelf: 'flex-start' }}
                                >
                                    {drivingWord(airSource)}
                                </Badge>
                            </Tooltip>
                        ) : undefined}

                        {/* Offered only while a person is driving, because holding the schedule off
                            a broadcast the schedule itself put on is not a thing to want. A hold
                            that cannot be SEEN is worse than no hold, so the state and the way out
                            of it are the same control. */}
                        {airSource === 'operator' ? (
                            <Group gap="xs" align="baseline" wrap="wrap">
                                {!held ? (
                                    <>
                                        <Text size="xs" c="dimmed">
                                            The schedule takes this back at the next block.
                                        </Text>
                                        {/* Each says what it does to the sentence above it rather
                                            than naming the mechanism. "Hold it" and "Hold two hours"
                                            are the station's word for this, and beside a line about
                                            the schedule taking the broadcast back they read as
                                            holding something else entirely — the record, the stream,
                                            the whole desk. */}
                                        <Anchor component="button" type="button" size="xs" disabled={hold.isPending} onClick={() => hold.mutate({})}>
                                            Keep it on past the next block
                                        </Anchor>
                                        <Anchor
                                            component="button"
                                            type="button"
                                            size="xs"
                                            disabled={hold.isPending}
                                            onClick={() => hold.mutate({ minutes: 120 })}
                                        >
                                            Keep it on for two hours
                                        </Anchor>
                                    </>
                                ) : (
                                    <>
                                        <Text size="xs" c="dimmed">
                                            {holdUntil === undefined
                                                ? 'Held until you release it. The schedule will not take this back.'
                                                : `Held until about ${new Date(holdUntil).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}.`}
                                        </Text>
                                        <Anchor
                                            component="button"
                                            type="button"
                                            size="xs"
                                            disabled={hold.isPending}
                                            onClick={() => hold.mutate(undefined)}
                                        >
                                            Release
                                        </Anchor>
                                    </>
                                )}
                            </Group>
                        ) : undefined}

                        {order?.brief ? (
                            <Tooltip
                                multiline
                                maw={360}
                                label="Every refill of this broadcast is programmed against this until the station is put on air again."
                            >
                                <Badge size="sm" variant="light" color="grape" tt="none" style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
                                    asked for: {order.brief}
                                </Badge>
                            </Tooltip>
                        ) : undefined}

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

                    {/* Wide enough for the longest thing the right-hand button ever says, which is
                        "Confirm stop", and the same width whatever it is saying. Both halves of
                        that matter: `grow` split the row evenly and clipped the armed label to
                        "Confirr", and sizing to the content instead would move Skip out from under
                        the pointer between the press that arms Stop and the press that fires it —
                        which is the one moment on this page when nothing may move. */}
                    <Stack gap="xs" w={phone ? '100%' : 214} style={{ flexShrink: 0 }}>
                        <Group gap="xs" wrap="nowrap">
                            <Tooltip label="Ends the track on air. The next one starts immediately.">
                                <Button
                                    variant="default"
                                    h={44}
                                    style={{ flex: 1 }}
                                    loading={skip.isPending}
                                    // Nothing on air is nothing to cut, and a skip needs a stream to take it.
                                    disabled={!status.streamUp || !nowPlaying}
                                    onClick={() => skip.mutate()}
                                >
                                    Skip
                                </Button>
                            </Tooltip>
                            {standingDown ? (
                                <Tooltip
                                    label="Puts the station back on air on the running order it was stopped on. Nothing is rebuilt."
                                    multiline
                                    maw={320}
                                >
                                    <Button
                                        h={44}
                                        w={phone ? undefined : 124}
                                        style={phone ? { flex: 1 } : undefined}
                                        loading={start.isPending}
                                        onClick={() => start.mutate()}
                                    >
                                        Start
                                    </Button>
                                </Tooltip>
                            ) : (
                                <Tooltip
                                    label={
                                        stopping.armed
                                            ? 'Press again to take the station off air. It forgets on its own in a few seconds.'
                                            : 'Ends the broadcast. What is playing stops too, and the mount goes quiet rather than falling back to a bed.'
                                    }
                                    multiline
                                    maw={320}
                                >
                                    {/* Filled once armed rather than outlined, so the state is
                                        legible across the room and not only in the word. */}
                                    {/* On a phone both halves are `flex: 1`, which keeps the two
                                        invariants the fixed 124 keeps on a desk: fifty-fifty is the
                                        same width whatever the label says, so "Confirm stop" cannot
                                        clip and Skip does not move between the press that arms Stop
                                        and the press that fires it. */}
                                    <Button
                                        color="red"
                                        variant={stopping.armed ? 'filled' : 'outline'}
                                        h={44}
                                        w={phone ? undefined : 124}
                                        style={phone ? { flex: 1 } : undefined}
                                        loading={stop.isPending}
                                        onClick={stopping.press}
                                    >
                                        {stopping.armed ? 'Confirm stop' : 'Stop'}
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
                            {/* Worded from the state it explains. Off air, the panel this opens is
                                headed "Waiting for a listener" and the eyebrow above it says READY,
                                so a button asking why it is ON air contradicted both of them and the
                                two words either side of itself. */}
                            {reading.live ? 'Why is it on air?' : 'Why is it not on air?'}
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

            {/* `SilenceDiagnosisPanel` rather than a list of gates drawn here.

                The design draws this as two columns of dots and sentences, and a first pass built
                exactly that — which quietly dropped the REMEDY. The panel carries, per fault, what
                would clear it, and a `docker` command comes with a copy button because the app
                cannot restart a sibling container. An operator chasing silence at 2am wants that
                line more than they want a tidy grid, and it is the one thing a dot cannot say. */}
            <Collapse expanded={why}>
                <Stack gap="sm">
                    {/* What the mount lease is renewed against, and the literal answer to the
                        question this disclosure asks. It is a station setting rather than a
                        transport command, and it lived on the transport strip for exactly that
                        reason: this is where somebody asks why nothing is going out.

                        Deleting the strip deleted the only control for it anywhere in the console,
                        which is how a station stuck in `audience` mode with nobody listening became
                        a thing an operator could see and not change. */}
                    {airMode ? (
                        <Group gap="sm" wrap="nowrap">
                            <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
                                On air
                            </Text>
                            <SegmentedControl
                                size="xs"
                                value={airMode}
                                disabled={setAirMode.isPending}
                                onChange={value => setAirMode.mutate({ airMode: value as 'audience' | 'always' })}
                                data={[
                                    { value: 'audience', label: 'when somebody is listening' },
                                    { value: 'always', label: 'always' },
                                ]}
                                aria-label="What puts the station on air"
                            />
                        </Group>
                    ) : undefined}

                    <SilenceDiagnosisPanel silence={silence} />
                </Stack>
            </Collapse>
        </Stack>
    );
}

/**
 * The badge's own word for who is driving.
 *
 * A sentence with a subject rather than a piece of station shorthand. "You are driving" and
 * "sustaining" both name a state the console understands and the reader has to be taught, and the
 * badge is the one place there is no room to teach it: whoever is reading this arrived because
 * something is playing and they want to know who chose it. So each of these answers that question in
 * the words the answer is actually in.
 */
function drivingWord(source: 'schedule' | 'sustaining' | 'operator'): string {
    if (source === 'operator') return 'You put this on';
    return source === 'sustaining' ? 'Between blocks' : 'The schedule put this on';
}

/**
 * What that word means, including the part an operator cannot see coming.
 *
 * The takeover sentence is the one worth the tooltip: a broadcast put on by hand is stamped with
 * whichever slot is in force, so it holds until the NEXT block begins and is then replaced. That is
 * correct and it is invisible, which is the combination worth saying out loud.
 */
function drivingLabel(source: 'schedule' | 'sustaining' | 'operator'): string {
    if (source === 'operator') return 'You put this on. It holds until the next scheduled block begins, and the schedule takes over then.';
    if (source === 'sustaining') return 'Nothing is scheduled right now, so the station is playing what it fills the gaps with.';

    return 'The clock changed the station over to this block. It runs until the block ends.';
}
