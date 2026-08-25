import { Anchor, Badge, Box, Button, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';

import { useRateTrack } from '../../api/catalog.queries';
import { useExtendOrder, useRemoveOrderItem, useShuffleOrder, useStationAir, useStationOrder } from '../../api/director.queries';
import { usePlayoutStatus, useStartPlayout, useStopPlayout } from '../../api/playout.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { notifyQueued } from '../shared/notify';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { StatusLamp } from '../shared/status.lamp';
import { SilenceDiagnosisPanel } from '../playout/silence.diagnosis.panel';
import { BriefTheStation } from './brief.the.station';
import { ClockOnAir } from './clock.on.air';
import { HostOnAir } from './host.on.air';
import { ReplanTheRest } from './replan.the.rest';
import { TakeACall } from './take.a.call';
import { StationOrderTable } from './station.order.table';

/**
 * What the station is airing, item by item.
 *
 * **The one running order there is.** It is not a stored list the station was pointed at: it was
 * built from a playlist when somebody put the station on, it is topped up as it runs down, and the
 * station's own breaks are planted into it. See `docs/decisions/on-air-ownership.md`.
 *
 * Everything on this page is a broadcast action. There is no draft to edit and no save button: a
 * shuffle here is heard by every listener within a few records, which is why the copy says what it
 * does to the station rather than what it does to a list.
 */
export function OnAirPage() {
    const air = useStationAir();
    const order = useStationOrder();
    const shuffle = useShuffleOrder();
    const extend = useExtendOrder();
    const removeItem = useRemoveOrderItem();
    const rateTrack = useRateTrack();
    const stop = useStopPlayout();
    const start = useStartPlayout();
    // The same query the shell polls for the transport strip, so this page's panel and
    // that strip cannot come to different conclusions about the same station.
    const playout = usePlayoutStatus(true);

    const loaded = order.data;
    const items = loaded?.items ?? [];
    const planned = items.filter(item => item.state === 'planned').length;
    const nothingOn = loaded !== undefined && items.length === 0;

    // Every one of these names its own action, which is what lets them share the alert stack below
    // rather than each hiding inside the tooltip of the button that asked for it. That was the old
    // arrangement and it was the wrong one twice over: a tooltip is hover-only, so a failure on the
    // console's most-watched page was invisible to somebody looking straight at it; and the button
    // turning red was the only persistent signal, which says something is wrong without saying what.
    const failures = [
        shuffle.isError ? apiErrorMessage(shuffle.error, 'The running order could not be shuffled.') : undefined,
        extend.isError ? apiErrorMessage(extend.error, 'A refill could not be queued.') : undefined,
        removeItem.isError ? apiErrorMessage(removeItem.error, 'That item could not be dropped.') : undefined,
        stop.isError ? apiErrorMessage(stop.error, 'The station could not be stopped.') : undefined,
        start.isError ? apiErrorMessage(start.error, 'The station could not be put back on air.') : undefined,
    ].filter((message): message is string => message !== undefined);

    // Stop deliberately leaves the running order alone so that Start can pick it up where it
    // stopped, and until now nothing on this page offered that Start: an operator who stopped a
    // station with a full order was shown Shuffle, Extend and Stop again, with no way back on air
    // from the one page whose whole subject is the running order. `false` rather than `!active`
    // because the air state may not have loaded yet, and an unknown station should read the way it
    // did before rather than flickering a Start on.
    const standingDown = air.data?.active === false;

    return (
        <Stack gap="lg">
            {/* The title line carries the name, the tally and the buttons, and nothing else. Every
                other badge WRAPS underneath, which is the whole of this: held on one nowrap row with
                five buttons, a show whose name runs to two lines squeezed the tally chip down to
                "O…" and truncated the audience-mode badge mid-word. A status nobody can read is
                worse than one on its own line. */}
            <PageHeader
                title={
                    <Group gap="sm" wrap="nowrap">
                        {loaded?.name || 'On air'}
                        {/* The tally light, and the one thing on this console that pulses. Stood
                            down is drawn as a quiet lamp rather than a second chip, because it is
                            a resting state an operator chose and not an alarm.

                            It may not SHRINK, which is the half the wrapping row above does not
                            cover: it shares the title's line by right, and a flex row given a show
                            name two lines long takes the space back out of the smallest thing on
                            it. That is how the tally came to read "ON …", which is a lamp saying
                            nothing at the top of the page whose subject is whether the station is
                            on air. */}
                        {air.data ? (
                            <Box style={{ flexShrink: 0 }}>
                                {air.data.active ? (
                                    <StatusLamp tone="live" label="on air" emphasis="chip" pulse />
                                ) : (
                                    <StatusLamp tone="off" label="stood down" size="md" />
                                )}
                            </Box>
                        ) : undefined}
                    </Group>
                }
                actions={
                    items.length > 0 ? (
                        <Group gap="sm" wrap="nowrap">
                            <Tooltip label="Shuffles everything the player is not already holding." multiline maw={320}>
                                <Button variant="light" loading={shuffle.isPending} disabled={planned < 2} onClick={() => shuffle.mutate()}>
                                    Shuffle
                                </Button>
                            </Tooltip>
                            {/* Beside Shuffle because they answer the same complaint and answer it
                            differently: a shuffle reorders the hour and this one replaces it. Not
                            disabled on a short tail the way Shuffle is — an order that has run dry
                            is exactly one worth replanning. */}
                            <ReplanTheRest brief={loaded?.brief ?? ''} disabled={nothingOn} />
                            {/* Beside the two that change what PLAYS, because it is the one that changes
                            what the station SAYS — and it belongs on this page rather than on
                            Productions for the reason the brief box does: it is about the show that
                            is running, and it inherits that show's host and its brief. */}
                            <TakeACall
                                brief={loaded?.brief ?? ''}
                                {...(loaded?.personaId === undefined ? {} : { personaId: loaded.personaId })}
                                disabled={nothingOn}
                            />
                            <Tooltip label="Queues a refill. The tracks land a few seconds later." multiline maw={320}>
                                <Button
                                    variant="light"
                                    loading={extend.isPending}
                                    // The records land seconds later and the order is polled every
                                    // five, so without this the button is pressed and nothing whatever
                                    // happens for long enough to press it again.
                                    onClick={() =>
                                        extend.mutate({}, { onSuccess: () => notifyQueued('Refill asked for. The records land in a few seconds.') })
                                    }
                                >
                                    Extend
                                </Button>
                            </Tooltip>
                            {standingDown ? (
                                <Tooltip
                                    label="Puts the station back on air on the running order it was stopped on. Nothing is rebuilt."
                                    multiline
                                    maw={320}
                                >
                                    <Button loading={start.isPending} onClick={() => start.mutate()}>
                                        Start
                                    </Button>
                                </Tooltip>
                            ) : (
                                <Tooltip
                                    label="Ends the broadcast. What is playing stops too, and the mount goes quiet rather than falling back to a bed."
                                    multiline
                                    maw={320}
                                >
                                    <Button color="red" variant="outline" loading={stop.isPending} onClick={() => stop.mutate()}>
                                        Stop
                                    </Button>
                                </Tooltip>
                            )}
                        </Group>
                    ) : undefined
                }
            >
                {/* `wrap` rather than `nowrap`, which is the point: these are all facts about the
                    show and none of them is worth abbreviating to keep the row one line. */}
                {loaded || air.data?.airMode === 'audience' ? (
                    <Group gap="xs" wrap="wrap">
                        {/* In `audience` mode a station that is active with a full running order is
                            still silent while nobody is connected. That is the intended state and
                            not a fault, so the console says it rather than leaving an operator
                            wondering why the mount is quiet. */}
                        {air.data?.airMode === 'audience' ? (
                            <Tooltip
                                multiline
                                maw={360}
                                label="This station airs only while somebody is listening. With nobody connected it stays silent on purpose, and starts the moment the first listener arrives."
                            >
                                <Badge size="sm" variant="light" color="gray" tt="none">
                                    when somebody is listening
                                </Badge>
                            </Tooltip>
                        ) : undefined}
                        {loaded ? (
                            <>
                                <Badge size="sm" variant="light" tt="none">
                                    {loaded.mode}
                                </Badge>
                                <Badge size="sm" variant="light" color="gray" tt="none">
                                    ends: {loaded.onEnd}
                                </Badge>
                                {/* Shown rather than only accepted, because it is still WORKING: every
                                    refill for the rest of this broadcast is programmed against it, so an
                                    operator wondering why the station keeps choosing what it chooses is
                                    looking at the answer. */}
                                {loaded.brief ? (
                                    <Tooltip
                                        multiline
                                        maw={360}
                                        label="Every refill of this broadcast is programmed against this until the station is put on air again."
                                    >
                                        <Badge size="sm" variant="light" color="grape" tt="none">
                                            asked for: {loaded.brief}
                                        </Badge>
                                    </Tooltip>
                                ) : undefined}
                                {/* A control rather than a label, and drawn whichever way the host was
                                    arrived at: this is the one place a show's presenter can be changed
                                    without starting a new broadcast, and the personas page deliberately
                                    cannot reach a show that named its own. */}
                                <HostOnAir
                                    {...(loaded.personaId === undefined ? {} : { personaId: loaded.personaId })}
                                    {...(loaded.personaLabel === undefined ? {} : { personaLabel: loaded.personaLabel })}
                                />
                                <Text size="sm" c="dimmed">
                                    {planned === 1 ? '1 still to come' : `${planned} still to come`}
                                </Text>
                            </>
                        ) : undefined}
                    </Group>
                ) : undefined}
            </PageHeader>

            {/* Above everything the operator can DO with the running order, because it is the
                question they came here with. It reads the transport poll the strip already
                runs, so this is one more reader of one reading rather than a second poll. */}
            {playout.data ? <SilenceDiagnosisPanel silence={playout.data.silence} /> : undefined}

            {order.error ? (
                <ErrorAlert title="The running order could not be read" error={order.error} fallback="The station is not answering." />
            ) : undefined}

            {failures.map(message => (
                <ErrorAlert key={message}>{message}</ErrorAlert>
            ))}

            {order.isPending ? <PageSkeleton variant="table" /> : undefined}

            {/* Two ways on air, and this one is first because it needs nothing prepared.
                Outside the empty state on purpose: Stop leaves the running order alone so that
                Start can resume it, so an operator who had been on air once could never get back
                to this box. Briefing the station is a command like Shuffle or Stop, available
                whenever the operator wants it, and it says which of the two things it is doing. */}
            {loaded ? <BriefTheStation replacing={items.length > 0} /> : undefined}

            {/* Beside it because they are the two halves of what a show IS: the box above says what
                this broadcast plays, and this says what the station says while it does. It belongs
                to the station rather than to the broadcast, which is the one thing on this page
                that is not a broadcast action, and it says so. Drawn with nothing on air too: an
                operator setting a station up for the first time is exactly who has an empty clock. */}
            {loaded ? <ClockOnAir /> : undefined}

            {/* The other way on, and it stays in the empty state: pointing an operator at a
                playlist is an answer to having nothing on, where an operator who already has a
                running order has the playlists page a click away in the nav. */}
            {nothingOn ? (
                <EmptyState
                    action={
                        /* `renderRoot` rather than `component={Link}`: the polymorphic form erases
                           the router's own types, and with them the check that `params` matches. */
                        <Anchor renderRoot={props => <Link to="/playlists" {...props} />} size="sm">
                            Browse playlists
                        </Anchor>
                    }
                >
                    Or start from a playlist. It is READ at the moment the station goes on air rather than copied, so there is nothing to prepare
                    first and nothing of yours is written into.
                </EmptyState>
            ) : undefined}

            {items.length > 0 ? (
                <StationOrderTable
                    items={items}
                    removingItemId={removeItem.isPending ? removeItem.variables : undefined}
                    onRemove={item => removeItem.mutate(item.id)}
                    // The running order is where an operator actually forms an opinion about a
                    // record: they are hearing it. The write goes to the catalog rather than to the
                    // order, and the order is re-read because it carries each row's rating.
                    ratingTrackId={rateTrack.isPending ? rateTrack.variables?.id : undefined}
                    onRate={(trackId, rating) => {
                        rateTrack.mutate({ id: trackId, rating });
                    }}
                />
            ) : undefined}
        </Stack>
    );
}
