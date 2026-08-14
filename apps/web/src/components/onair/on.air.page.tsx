import { Alert, Anchor, Badge, Button, Card, Group, Skeleton, Stack, Text, Title, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';

import { useRateTrack } from '../../api/catalog.queries';
import { useExtendOrder, useRemoveOrderItem, useShuffleOrder, useStationAir, useStationOrder } from '../../api/director.queries';
import { usePlayoutStatus, useStopPlayout } from '../../api/playout.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { SilenceDiagnosisPanel } from '../playout/silence.diagnosis.panel';
import { BriefTheStation } from './brief.the.station';
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
    // The same query the shell polls for the transport strip, so this page's panel and
    // that strip cannot come to different conclusions about the same station.
    const playout = usePlayoutStatus(true);

    const loaded = order.data;
    const items = loaded?.items ?? [];
    const planned = items.filter(item => item.state === 'planned').length;
    const nothingOn = loaded !== undefined && items.length === 0;

    // Kept per action rather than raised as one page-level alert: each belongs to the button that
    // asked for it, and the air state above reports the station independently of any of them.
    const shuffleFailure = shuffle.isError ? apiErrorMessage(shuffle.error, 'The running order could not be shuffled.') : undefined;
    const extendFailure = extend.isError ? apiErrorMessage(extend.error, 'A refill could not be queued.') : undefined;
    const removeFailure = removeItem.isError ? apiErrorMessage(removeItem.error, 'That item could not be dropped.') : undefined;
    const stopFailure = stop.isError ? apiErrorMessage(stop.error, 'The station could not be stopped.') : undefined;

    return (
        <Stack gap="lg">
            <Group justify="space-between" align="flex-end" wrap="nowrap">
                <Stack gap={6}>
                    <Group gap="sm" wrap="nowrap">
                        <Title order={1}>{loaded?.name || 'On air'}</Title>
                        {air.data ? (
                            <Badge variant={air.data.active ? 'filled' : 'light'} color={air.data.active ? 'red' : 'gray'}>
                                {air.data.active ? 'on air' : 'stood down'}
                            </Badge>
                        ) : undefined}
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
                    </Group>
                    {loaded ? (
                        <Group gap="xs">
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
                            <Text size="sm" c="dimmed">
                                {planned === 1 ? '1 still to come' : `${planned} still to come`}
                            </Text>
                        </Group>
                    ) : undefined}
                </Stack>

                {items.length > 0 ? (
                    <Group gap="sm" wrap="nowrap">
                        <Tooltip
                            label={shuffleFailure ?? 'Shuffles everything the player is not already holding.'}
                            color={shuffleFailure ? 'red' : undefined}
                            multiline
                            maw={320}
                        >
                            <Button
                                variant="light"
                                color={shuffleFailure ? 'red' : undefined}
                                loading={shuffle.isPending}
                                disabled={planned < 2}
                                onClick={() => shuffle.mutate()}
                            >
                                Shuffle
                            </Button>
                        </Tooltip>
                        <Tooltip
                            label={extendFailure ?? 'Queues a refill. The tracks land a few seconds later.'}
                            color={extendFailure ? 'red' : undefined}
                            multiline
                            maw={320}
                        >
                            <Button
                                variant="light"
                                color={extendFailure ? 'red' : undefined}
                                loading={extend.isPending}
                                onClick={() => extend.mutate({})}
                            >
                                Extend
                            </Button>
                        </Tooltip>
                        <Tooltip
                            label={
                                stopFailure ??
                                'Ends the broadcast. What is playing stops too, and the mount goes quiet rather than falling back to a bed.'
                            }
                            color={stopFailure ? 'red' : undefined}
                            multiline
                            maw={320}
                        >
                            <Button color="red" variant="outline" loading={stop.isPending} onClick={() => stop.mutate()}>
                                Stop
                            </Button>
                        </Tooltip>
                    </Group>
                ) : undefined}
            </Group>

            {/* Above everything the operator can DO with the running order, because it is the
                question they came here with. It reads the transport poll the strip already
                runs, so this is one more reader of one reading rather than a second poll. */}
            {playout.data ? <SilenceDiagnosisPanel silence={playout.data.silence} /> : undefined}

            {order.error ? (
                <Alert color="red" title="The running order could not be read">
                    {apiErrorMessage(order.error, 'The station is not answering.')}
                </Alert>
            ) : undefined}

            {removeFailure ? <Alert color="red">{removeFailure}</Alert> : undefined}

            {order.isPending ? <Skeleton height={280} radius="sm" /> : undefined}

            {/* Two ways on air, and this one is first because it needs nothing prepared.
                Outside the empty state on purpose: Stop leaves the running order alone so that
                Start can resume it, so an operator who had been on air once could never get back
                to this box. Briefing the station is a command like Shuffle or Stop, available
                whenever the operator wants it, and it says which of the two things it is doing. */}
            {loaded ? <BriefTheStation replacing={items.length > 0} /> : undefined}

            {/* The other way on, and it stays in the empty state: pointing an operator at a
                playlist is an answer to having nothing on, where an operator who already has a
                running order has the playlists page a click away in the nav. */}
            {nothingOn ? (
                <Card withBorder padding="xl" radius="sm">
                    <Stack gap="xs" align="flex-start">
                        <Text size="sm" c="dimmed">
                            Or start from a playlist. It is READ at the moment the station goes on air rather than copied, so there is nothing to
                            prepare first and nothing of yours is written into.
                        </Text>
                        {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases
                            the router's own types, and with them the check that `params` matches. */}
                        <Anchor renderRoot={props => <Link to="/playlists" {...props} />} size="sm">
                            Browse playlists
                        </Anchor>
                    </Stack>
                </Card>
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
