import { useState } from 'react';
import { Anchor, Badge, Box, Button, Card, Collapse, Group, Progress, SegmentedControl, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { PlayoutStatus, StationOrder } from '@deadair/sdk';

import { useHoldAgainstSchedule, useKeepQuiet, useSetAirMode } from '../../api/director.queries';
import { useStartCast, useStopCast } from '../../api/outputs.queries';
import { useStartPlayout, useStopPlayout, useSkipCurrent } from '../../api/playout.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { usePlayhead } from '../playout/playhead';
import { SilenceDiagnosisPanel } from '../playout/silence.diagnosis.panel';
import { readSilence } from '../playout/silence.reading';
import { StaleConfigAlert } from '../playout/stale.config.alert';
import { Artwork } from '../shared/artwork';
import { AuthoredBadge } from '../shared/authored.badge';
import { TrackLink } from '../shared/catalog.links';
import { ErrorAlert } from '../shared/error.alert';
import { formatDuration } from '../shared/format.duration';
import { usePhone } from '../shared/use.phone';
import { HostOnAir } from '../onair/host.on.air';
import { BreakSources, RENDER_PLUGIN_ID } from '../scripts/break.sources';
import { useArmedPress } from './armed.press';
import { CastMenu } from './cast.menu';
import { LiveInput } from './live.input';
import { formatClock } from '../../i18n/format.locale';

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
    /** How many more records the station keeps its own breaks off the air for. Absent is not quiet. */
    quietRecords?: number;
}

/** The two fixed lengths of quiet on offer, in records. "The rest of the order" is the third, counted. */
const QUIET_SHORT = 3;
const QUIET_LONG = 10;

/** Records in the order still to start, which is what "the rest of the order" keeps quiet for. */
const recordsToCome = (order: StationOrder | undefined): number =>
    order?.items.filter(item => item.kind === 'track' && (item.state === 'planned' || item.state === 'handed')).length ?? 0;

/**
 * What is going out, right now, at the top of the desk.
 *
 * This one panel replaces four surfaces that each told part of it: the tally badge on the old home
 * page, the transport strip across the footer, the On-air page's header, and the "On air" card on
 * Check-up. They did not disagree often, but they COULD, and on the console's landing screen the
 * question is always the same one — is it out, and what is it.
 *
 * It is the desk's pinned column, drawn top to bottom: the record, how far in, then the controls.
 * Going live and casting to a speaker sit in the same grid as the transport, and the live input's
 * own controls open inside the card rather than in a card under it.
 *
 * The two transport controls are Skip and Stop, and they are here because the footer that used to carry them
 * is gone. That is the trade the footer was not worth: a strip under every page, reserving height on
 * Settings and the catalog, to carry two buttons that only mean anything while looking at what is on
 * air. Here they sit beside the thing they act on.
 *
 * "Why is it on air?" is shut by default. Seven gates all reporting fine is a wall of text answering
 * a question nobody asked while the station is working — and the moment it is worth reading is the
 * moment something is wrong, which is when the panel below draws itself open anyway.
 *
 * Of the three controls only Stop asks twice — see {@link useArmedPress}. Skip ends one record and
 * Start puts a station back on air, and neither is a press worth a second thought.
 */
export function OnAirNow({ status, order, standingDown, airMode, airSource, held = false, holdUntil, quietRecords }: OnAirNowProps) {
    const { t } = useTranslation('desk');
    const hold = useHoldAgainstSchedule();
    const quiet = useKeepQuiet();
    const rest = recordsToCome(order);
    const [why, setWhy] = useState(false);
    const [liveOpen, setLiveOpen] = useState(false);
    const skip = useSkipCurrent();
    const stop = useStopPlayout();
    const start = useStartPlayout();
    const setAirMode = useSetAirMode();
    const startCast = useStartCast();
    const stopCast = useStopCast();
    const stopping = useArmedPress(() => stop.mutate());

    const { nowPlaying, upNext, queuedCount, silence, live } = status;
    const reading = readSilence(silence);
    const playhead = usePlayhead(nowPlaying);
    const phone = usePhone();

    // Named actions sharing one stack, rather than each hiding in the tooltip of the button that
    // asked for it: a tooltip is hover-only, so a failure on the console's landing page would be
    // invisible to somebody looking straight at it.
    const failures = [
        skip.isError ? apiErrorMessage(skip.error, t('onAir.skipFailed')) : undefined,
        stop.isError ? apiErrorMessage(stop.error, t('onAir.stopFailed')) : undefined,
        start.isError ? apiErrorMessage(start.error, t('onAir.startFailed')) : undefined,
        startCast.isError ? apiErrorMessage(startCast.error, t('onAir.cast.startFailed')) : undefined,
        stopCast.isError ? apiErrorMessage(stopCast.error, t('onAir.cast.stopFailed')) : undefined,
        quiet.isError ? apiErrorMessage(quiet.error, t('onAir.quietFailed')) : undefined,
        hold.isError ? apiErrorMessage(hold.error, t('onAir.holdFailed')) : undefined,
        setAirMode.isError ? apiErrorMessage(setAirMode.error, t('onAir.airModeFailed')) : undefined,
    ].filter((message): message is string => message !== undefined);

    return (
        <Stack gap="sm">
            <Card
                padding="md"
                // The tally rule along the top edge, in the one colour that means ON AIR on a desk.
                // Dimmed to the border's own weight when it is not: a red rule over a stood-down
                // station is the single most misleading mark this console could make.
                style={{ borderTop: `3px solid ${reading.live ? 'var(--mantine-color-red-6)' : 'var(--da-border)'}` }}
            >
                {/* One column, top to bottom, because the desk pins this card in a column of its own
                    beside the running order: what it is, how far in, then the controls. The same
                    shape on a phone, where the column is the whole screen. */}
                <Stack gap="sm">
                    <Group align="flex-start" wrap="nowrap" gap="md">
                        {/* Only while there is something on air. An empty square beside "waiting for a
                            listener" reads as a second thing being wrong rather than as art the
                            station does not have — and the station is most often idle at exactly the
                            moment an operator opens the console to check nothing is broken. */}
                        {nowPlaying ? <Artwork src={nowPlaying.item.artworkUrl} alt={nowPlaying.item.title} size={phone ? 72 : 96} /> : undefined}

                        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                            <Text
                                size="xs"
                                fw={600}
                                tt="uppercase"
                                ff="monospace"
                                c={reading.live ? 'red.3' : 'dimmed'}
                                style={{ letterSpacing: 'var(--da-tracking-eyebrow)' }}
                                className={reading.live ? 'da-lamp-pulse' : undefined}
                            >
                                {reading.live ? t('onAir.onAirNow') : reading.label}
                            </Text>
                            {order ? (
                                <Group gap="xxs" wrap="wrap" style={{ minWidth: 0 }}>
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

                            {/* Who chose this. The console has always been able to say WHAT is on and
                                never who put it there, and with a schedule running those are different
                                questions: an operator's own choice holds until the next block begins,
                                so "the clock is driving" and "you are" can each be true for an hour at
                                a time with nothing on the screen distinguishing them. */}
                            {airSource && airSource !== 'off' ? (
                                <Tooltip multiline maw={360} label={drivingLabel(t, airSource)}>
                                    <Badge
                                        size="sm"
                                        variant="light"
                                        color={airSource === 'operator' ? 'orange' : 'gray'}
                                        tt="none"
                                        style={{ alignSelf: 'flex-start' }}
                                    >
                                        {drivingWord(t, airSource)}
                                    </Badge>
                                </Tooltip>
                            ) : undefined}
                        </Stack>
                    </Group>

                    {nowPlaying ? (
                        <Stack gap={2} style={{ minWidth: 0 }}>
                            {/* Only the title is linked: the player is handed a copy and knows its
                                canonical track, not which artist the catalog files it under. Two
                                lines rather than one, because the column is narrow and a title cut to
                                its first three words is not the record's name. */}
                            <TrackLink id={nowPlaying.item.trackId} fz={22} ff="heading" fw={600} lineClamp={2}>
                                {nowPlaying.item.title}
                            </TrackLink>
                            <Text c="dimmed" truncate>
                                {nowPlaying.item.artists.join(', ')}
                            </Text>
                        </Stack>
                    ) : (
                        // A presenter on the live input is on the air with no record to name, which
                        // would otherwise read as the station starting up. The live controls below
                        // have the rest.
                        <Text c="dimmed">
                            {status.live?.state === 'onair' ? t('onAir.presenterLive') : silence.audible ? t('onAir.starting') : silence.detail}
                        </Text>
                    )}

                    {/* While a break airs, where what it is saying came from. Only what it said. */}
                    {nowPlaying?.item.pluginId === RENDER_PLUGIN_ID ? <BreakSources segmentId={nowPlaying.item.externalId} saidOnly /> : undefined}

                    {playhead ? (
                        <Group gap="xs" wrap="nowrap">
                            <Text size="xs" c="dimmed" className="da-num">
                                {formatDuration(playhead.elapsedMs)}
                            </Text>
                            <Progress value={playhead.percent} size={4} radius="xl" style={{ flex: 1 }} aria-label={t('onAir.progress')} />
                            <Text size="xs" c="dimmed" className="da-num">
                                -{formatDuration(playhead.remainingMs)}
                            </Text>
                        </Group>
                    ) : undefined}

                    {/* On a phone only. On a desk the running order is beside this card and already
                        says what comes next, with the time it comes; here it is a screen away. */}
                    {phone && upNext.length > 0 ? (
                        <Group gap="xs" wrap="wrap">
                            <Text size="sm" c="dimmed">
                                {t('onAir.upNext')}
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
                                    {t('onAir.toCome', { count: queuedCount - 3 })}
                                </Text>
                            ) : undefined}
                        </Group>
                    ) : undefined}

                    {/* Two even columns, so every button is the same width whatever it is saying.
                        Both halves of that matter for Stop: sizing it to its content would clip or
                        move between "Stop" and "Confirm stop", and Skip with it — which is the one
                        moment on this page when nothing may move. */}
                    <SimpleGrid cols={2} spacing="xs">
                        <Tooltip label={t('onAir.skipHint')}>
                            <Button
                                variant="default"
                                h={40}
                                w="100%"
                                loading={skip.isPending}
                                // Nothing on air is nothing to cut, and a skip needs a stream to take it.
                                disabled={!status.streamUp || !nowPlaying}
                                onClick={() => skip.mutate(nowPlaying?.item.id)}
                            >
                                {t('onAir.skip')}
                            </Button>
                        </Tooltip>
                        {standingDown ? (
                            <Tooltip label={t('onAir.startHint')} multiline maw={320}>
                                <Button h={40} w="100%" loading={start.isPending} onClick={() => start.mutate()}>
                                    {t('onAir.start')}
                                </Button>
                            </Tooltip>
                        ) : (
                            <Tooltip label={stopping.armed ? t('onAir.stopArmedHint') : t('onAir.stopHint')} multiline maw={320}>
                                {/* Filled once armed rather than outlined, so the state is legible
                                    across the room and not only in the word. */}
                                <Button
                                    color="red"
                                    variant={stopping.armed ? 'filled' : 'outline'}
                                    h={40}
                                    w="100%"
                                    loading={stop.isPending}
                                    onClick={stopping.press}
                                >
                                    {stopping.armed ? t('onAir.confirmStop') : t('onAir.stop')}
                                </Button>
                            </Tooltip>
                        )}
                        {/* Only when the station reports a live input at all: an audio chain too old
                            to have one says nothing, and offering to arm an input that is not there
                            would be a button that always fails. Once somebody is armed or on, the live
                            controls are open whatever this says, because they are the presenter's cue. */}
                        {live?.state === 'off' ? (
                            <Button
                                variant="light"
                                h={36}
                                w="100%"
                                rightSection={liveOpen ? <IconChevronUp size={14} stroke={1.8} /> : <IconChevronDown size={14} stroke={1.8} />}
                                onClick={() => setLiveOpen(open => !open)}
                                aria-expanded={liveOpen}
                            >
                                {t('onAir.goLive')}
                            </Button>
                        ) : undefined}
                        <CastMenu
                            block
                            onStart={request => startCast.mutate(request)}
                            onStop={(pluginId, deviceId) => stopCast.mutate({ pluginId, deviceId })}
                            busy={startCast.isPending || stopCast.isPending}
                        />
                    </SimpleGrid>

                    {live && (live.state !== 'off' || liveOpen) ? <LiveInput live={live} bare /> : undefined}

                    {/* Offered only while a person is driving, because holding the schedule off a
                        broadcast the schedule itself put on is not a thing to want. A hold that cannot
                        be SEEN is worse than no hold, so the state and the way out of it are the same
                        control. */}
                    {airSource === 'operator' ? (
                        <Group gap="xs" align="baseline" wrap="wrap">
                            {!held ? (
                                <>
                                    <Text size="xs" c="dimmed">
                                        {t('onAir.takesBack')}
                                    </Text>
                                    {/* Each says what it does to the sentence above it rather than
                                        naming the mechanism. "Hold it" and "Hold two hours" are the
                                        station's word for this, and beside a line about the schedule
                                        taking the broadcast back they read as holding something else
                                        entirely — the record, the stream, the whole desk. */}
                                    <Anchor component="button" type="button" size="xs" disabled={hold.isPending} onClick={() => hold.mutate({})}>
                                        {t('onAir.keepPastBlock')}
                                    </Anchor>
                                    <Anchor
                                        component="button"
                                        type="button"
                                        size="xs"
                                        disabled={hold.isPending}
                                        onClick={() => hold.mutate({ minutes: 120 })}
                                    >
                                        {t('onAir.keepTwoHours')}
                                    </Anchor>
                                </>
                            ) : (
                                <>
                                    <Text size="xs" c="dimmed">
                                        {holdUntil === undefined
                                            ? t('onAir.heldUntilRelease')
                                            : t('onAir.heldUntil', { time: formatClock(new Date(holdUntil)) })}
                                    </Text>
                                    <Anchor
                                        component="button"
                                        type="button"
                                        size="xs"
                                        disabled={hold.isPending}
                                        onClick={() => hold.mutate(undefined)}
                                    >
                                        {t('onAir.release')}
                                    </Anchor>
                                </>
                            )}
                        </Group>
                    ) : undefined}

                    {/* The same shape as the hold above and for its reason: a station that has gone
                        quiet on purpose and one that has silently stopped talking sound the same, so
                        while a spell runs the control IS the countdown and its way out, rather than a
                        segment claiming a selection the station is counting down from. Offered only
                        while the station is on, since there is nothing to keep quiet on a station
                        stood down. */}
                    {!standingDown && order ? (
                        <Stack gap={6}>
                            <Tooltip multiline maw={320} label={t('onAir.quietHint')}>
                                <Text
                                    size="xs"
                                    fw={600}
                                    tt="uppercase"
                                    ff="monospace"
                                    c="dimmed"
                                    style={{ letterSpacing: 'var(--da-tracking-eyebrow)', alignSelf: 'flex-start' }}
                                >
                                    {t('onAir.talk')}
                                </Text>
                            </Tooltip>
                            {quietRecords === undefined ? (
                                <SegmentedControl
                                    size="xs"
                                    fullWidth
                                    value="planned"
                                    disabled={quiet.isPending}
                                    onChange={value => {
                                        if (value !== 'planned') quiet.mutate(Number(value));
                                    }}
                                    aria-label={t('onAir.quietAria')}
                                    data={[
                                        { value: 'planned', label: t('onAir.quietPlanned') },
                                        { value: String(QUIET_SHORT), label: t('onAir.quietThree') },
                                        { value: String(QUIET_LONG), label: t('onAir.quietTen') },
                                        // Only when the order holds more than the longer of the two, or
                                        // it would offer the same thing twice.
                                        ...(rest > QUIET_LONG ? [{ value: String(rest), label: t('onAir.quietRest') }] : []),
                                    ]}
                                />
                            ) : (
                                <Group gap="xs" align="baseline" wrap="wrap">
                                    <Text size="xs" c="orange.4">
                                        {t('onAir.quietFor', { count: quietRecords })}
                                    </Text>
                                    <Anchor
                                        component="button"
                                        type="button"
                                        size="xs"
                                        disabled={quiet.isPending}
                                        onClick={() => quiet.mutate(undefined)}
                                    >
                                        {t('onAir.talkAgain')}
                                    </Anchor>
                                </Group>
                            )}
                        </Stack>
                    ) : undefined}

                    {order?.brief ? (
                        <Tooltip multiline maw={360} label={t('onAir.briefHint')}>
                            <AuthoredBadge size="sm" tt="none" style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
                                {t('onAir.brief', { brief: order.brief })}
                            </AuthoredBadge>
                        </Tooltip>
                    ) : undefined}

                    {/* In a Group because a Card's Stack stretches what it holds, which drew this as a
                        bar the width of the card. */}
                    <Group>
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
                                so a button asking why it is ON air contradicted both of them. */}
                            {reading.live ? t('onAir.whyOnAir') : t('onAir.whyNotOnAir')}
                        </Button>
                    </Group>
                </Stack>
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
                                {t('onAir.airModeLabel')}
                            </Text>
                            <SegmentedControl
                                size="xs"
                                value={airMode}
                                disabled={setAirMode.isPending}
                                onChange={value => setAirMode.mutate({ airMode: value as 'audience' | 'always' })}
                                data={[
                                    { value: 'audience', label: t('onAir.airMode.audience') },
                                    { value: 'always', label: t('onAir.airMode.always') },
                                ]}
                                aria-label={t('onAir.airModeAria')}
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
function drivingWord(t: TFunction<'desk'>, source: 'schedule' | 'sustaining' | 'operator'): string {
    return t(`onAir.driving.word.${source}`);
}

/**
 * What that word means, including the part an operator cannot see coming.
 *
 * The takeover sentence is the one worth the tooltip: a broadcast put on by hand is stamped with
 * whichever slot is in force, so it holds until the NEXT block begins and is then replaced. That is
 * correct and it is invisible, which is the combination worth saying out loud.
 */
function drivingLabel(t: TFunction<'desk'>, source: 'schedule' | 'sustaining' | 'operator'): string {
    return t(`onAir.driving.label.${source}`);
}
