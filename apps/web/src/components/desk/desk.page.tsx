import { useCallback, useMemo } from 'react';
import { Button, Group, Stack, Text, Title, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { Anchor } from '@mantine/core';
import type { Rating, StationOrderItem } from '@deadair/sdk';

import { useRateTrack } from '../../api/catalog.queries';
import {
    useAddOrderTrack,
    useExtendOrder,
    useMoveOrderItem,
    useRemoveOrderItem,
    useShuffleOrder,
    useStationAir,
    useStationOrder,
} from '../../api/director.queries';
import { usePlayoutStatus } from '../../api/playout.queries';
import { useStationAttention } from '../../api/station.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { runsDryAt, whatHappensThen } from '../onair/order.runs.dry';
import { PlanTheStation } from '../onair/plan.the.station';
import { TakeACall } from '../onair/take.a.call';
import { StationOrderTable } from '../onair/station.order.table';
import { AttentionList } from '../station/attention.list';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { notifyQueued, notifyUndoable } from '../shared/notify';
import { PageSkeleton } from '../shared/page.skeleton';
import { OnAirNow } from './on.air.now';

/**
 * The desk: what is going out, what needs a person, and what is coming.
 *
 * ## Why this is one page
 *
 * It was two. The home page was a masthead and a list of faults; the On-air page was the running
 * order and the transport. An operator checking in a few times a day opened the first, learned
 * nothing actionable about the broadcast, and clicked through to the second — so the landing page
 * was a toll gate on the page they actually wanted. Worse, the two disagreed: both drew the tally,
 * from the same reading, in different words.
 *
 * The three zones are ordered by how often the answer is needed. What is on air is the question
 * every visit starts with. What needs you is the reason to have opened the console at all. The
 * running order is what you read once the first two are fine.
 *
 * ## Where the transport went
 *
 * There is no footer strip any more. It sat under every page — Settings, the catalog, the plugin
 * list — reserving height and polling, to carry two controls that only mean anything while looking
 * at what is on air. Skip and Stop are on the panel above instead, beside the thing they act on.
 *
 * ## What the attention rows can and cannot promise
 *
 * The design this page is built from puts the remedy on the row as a verb: "Reconnect Spotify",
 * "Add a key". The station does not send one. `AttentionItem` carries a `route` and no action, so
 * every such button would navigate and nothing more, and a button that says it will reconnect
 * Spotify while only opening a page is the kind of small lie this console is otherwise careful not
 * to tell. The rows carry their destination as a button — the action, honestly named. Giving the
 * station a remedy verb to send is the change that would make the design's version true.
 */
export function DeskPage() {
    // Every one of these shares a query key with the shell's own polling, so the desk is one more
    // reader of one reading rather than a second request per panel.
    const playout = usePlayoutStatus(true);
    const attention = useStationAttention(true);
    const air = useStationAir();
    const order = useStationOrder();

    // Read here, ahead of the mutations below, because `onRemove`'s undo needs the position a
    // dropped row held AT THE MOMENT of the click — the table redraws under an operator's hand
    // every five seconds, so a captured index from anywhere else risks naming a row that has moved.
    const loaded = order.data;
    // Memoised on the query's own data rather than recomputed: `?? []` mints a new array every
    // render, and `onRemove` below closes over this one, so without it every poll hands the table a
    // new handler and undoes the memoisation the rows are relying on.
    const items = useMemo(() => loaded?.items ?? [], [loaded]);

    const shuffle = useShuffleOrder();
    const extend = useExtendOrder();
    const removeItem = useRemoveOrderItem();
    const addTrack = useAddOrderTrack();
    const moveItem = useMoveOrderItem();
    const rateTrack = useRateTrack();

    // Stable across renders, so the table's memoised rows survive the five-second poll instead of
    // re-rendering under handlers that are new objects each time. `mutate` is destructured because
    // the mutation object is new each render and its `mutate` is not, and the deps lint counts
    // identifiers rather than knowing that.
    const { mutate: removeOrderItem } = removeItem;
    const { mutate: addOrderTrack } = addTrack;
    const { mutate: moveOrderItem } = moveItem;
    const { mutate: rateRecord } = rateTrack;
    // A record is spliced out of the order entirely when it is dropped — unlike a segment, which is
    // only marked `removed`, on the ownership rule's argument (`docs/internals/director.md` § "Who
    // owns the running order") that a break planted again into the same slot a minute later is worse
    // than one left marked — so a track is the one kind of drop that can be taken back. The position
    // is read out of `items` at the moment of the click rather than trusted from a stale closure,
    // because the table redraws under an operator's hand every five seconds.
    const onRemove = useCallback(
        (item: StationOrderItem) => {
            const trackId = item.kind === 'track' ? item.trackId : undefined;
            const atIndex = items.findIndex(candidate => candidate.id === item.id);
            removeOrderItem(item.id, {
                onSuccess: () => {
                    if (trackId === undefined) return;
                    notifyUndoable(`Dropped “${item.title}”.`, {
                        label: 'Put it back',
                        onUndo: () => addOrderTrack({ trackId, ...(atIndex < 0 ? {} : { atIndex }) }),
                    });
                },
            });
        },
        [removeOrderItem, addOrderTrack, items],
    );
    // The only way to reorder the hour that is not Shuffle, which reorders all of it. The table
    // decides the index, because what is legal is a fact about the rows it is holding rather than
    // something this page can work out.
    const onMove = useCallback((item: StationOrderItem, toIndex: number) => moveOrderItem({ itemId: item.id, toIndex }), [moveOrderItem]);
    // The running order is where an operator actually forms an opinion about a record: they are
    // hearing it. The write goes to the catalog rather than to the order, and the order is re-read
    // because it carries each row's rating.
    const onRate = useCallback((trackId: string, rating: Rating) => rateRecord({ id: trackId, rating }), [rateRecord]);

    const planned = items.filter(item => item.state === 'planned').length;
    const nothingOn = loaded !== undefined && items.length === 0;
    // Only while something is actually going out. Off air the order is not running down at all, so
    // a clock time would be a projection from a broadcast that is not happening — and the panel
    // above is already saying the station is stood down, which is the more useful fact.
    const dryAt = playout.data?.nowPlaying ? runsDryAt(items, playout.data.nowPlaying.remainingMs) : undefined;
    // `false` rather than `!active` because the air reading may not have loaded, and an unknown
    // station should read the way it did rather than flickering a Start on.
    const standingDown = air.data?.active === false;

    const failures = [
        shuffle.isError ? apiErrorMessage(shuffle.error, 'The running order could not be shuffled.') : undefined,
        extend.isError ? apiErrorMessage(extend.error, 'A refill could not be queued.') : undefined,
        removeItem.isError ? apiErrorMessage(removeItem.error, 'That item could not be dropped.') : undefined,
        // Named rather than left silent, because the interesting failure here is a race an operator
        // cannot see coming: the player takes the front of the order while the page is being read,
        // and the position that was legal when the row was drawn is refused by the time it is
        // clicked. The API's own sentence says which, so it is worth showing.
        moveItem.isError ? apiErrorMessage(moveItem.error, 'That item could not be moved.') : undefined,
    ].filter((message): message is string => message !== undefined);

    return (
        <Stack gap="xl">
            {playout.data ? (
                <OnAirNow
                    status={playout.data}
                    order={loaded}
                    standingDown={standingDown}
                    {...(air.data?.airMode === undefined ? {} : { airMode: air.data.airMode })}
                    {...(air.data?.airSource === undefined ? {} : { airSource: air.data.airSource })}
                    {...(air.data?.held === undefined ? {} : { held: air.data.held })}
                    {...(air.data?.holdUntil === undefined ? {} : { holdUntil: air.data.holdUntil })}
                />
            ) : (
                <PageSkeleton variant="card" />
            )}

            <Stack gap="sm">
                <Group gap="sm" align="baseline">
                    <Title order={2}>Needs you</Title>
                    <Text size="sm" c="dimmed">
                        {needsYouBlurb(attention.data?.items.length)}
                    </Text>
                </Group>

                {attention.isPending ? <PageSkeleton variant="card" /> : undefined}

                {/* The list failing is not the station failing, and saying which is the difference
                    between a console an operator trusts and one they second-guess. */}
                {attention.error ? (
                    <ErrorAlert
                        title="The station could not be asked what needs you"
                        error={attention.error}
                        fallback="Nothing is known to be wrong; this list is what is unavailable."
                    />
                ) : undefined}

                {/* `here` because this page is what `/onair` resolves to: without it every row
                    about the broadcast carried a `Desk →` button that navigated to the page it was
                    already drawn on. Its evidence links still work — they point at records. */}
                {attention.data ? <AttentionList items={attention.data.items} here="/" /> : undefined}
            </Stack>

            <Stack gap="sm">
                <Group justify="space-between" align="baseline" gap="md" wrap="wrap">
                    <Group gap="sm" align="baseline">
                        <Title order={2}>Running order</Title>
                        <Text size="sm" c="dimmed">
                            What the station will play, and what it will say over it.
                        </Text>
                    </Group>
                    {/* Drawn whenever the order has LOADED rather than whenever it has items, which
                        the whole row used to be gated on. Plan is how the station goes on air from
                        this page, and hiding it on an empty order left an operator who had pressed
                        Stop with no way back other than the playlists page. Shuffle and Take a call
                        disable themselves instead, because neither means anything with nothing on. */}
                    {loaded ? (
                        <Group gap="xs" wrap="wrap">
                            <Tooltip
                                label="Shuffles everything the player is not already holding. With smart shuffle on, one artist stays off its own heels and anything aired lately goes toward the back."
                                multiline
                                maw={320}
                            >
                                <Button
                                    variant="default"
                                    size="compact-md"
                                    loading={shuffle.isPending}
                                    disabled={planned < 2}
                                    onClick={() => shuffle.mutate()}
                                >
                                    Shuffle
                                </Button>
                            </Tooltip>
                            {/* Beside Shuffle because they answer the same complaint differently: a
                                shuffle reorders the hour, and this one changes what is in it —
                                either from here on, or as a new show. */}
                            <PlanTheStation {...(loaded === undefined ? {} : { order: loaded })} />
                            {/* The one that changes what the station SAYS rather than what it plays.
                                It inherits this broadcast's host and brief, which is why it is here
                                rather than on Voice. */}
                            <TakeACall
                                brief={loaded?.brief ?? ''}
                                {...(loaded?.personaId === undefined ? {} : { personaId: loaded.personaId })}
                                disabled={nothingOn}
                            />
                        </Group>
                    ) : undefined}
                </Group>

                {order.error ? (
                    <ErrorAlert title="The running order could not be read" error={order.error} fallback="The station is not answering." />
                ) : undefined}

                {failures.map(message => (
                    <ErrorAlert key={message}>{message}</ErrorAlert>
                ))}

                {order.isPending ? <PageSkeleton variant="table" /> : undefined}

                {nothingOn ? (
                    <EmptyState
                        action={
                            /* `renderRoot` rather than `component={Link}`: the polymorphic form
                               erases the router's own types, and with them the check on `params`. */
                            <Anchor renderRoot={(props: object) => <Link to="/playlists" {...props} />} size="sm">
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
                        collapseHistory
                        removingItemId={removeItem.isPending ? removeItem.variables : undefined}
                        onRemove={onRemove}
                        movingItemId={moveItem.isPending ? moveItem.variables?.itemId : undefined}
                        onMove={onMove}
                        ratingTrackId={rateTrack.isPending ? rateTrack.variables?.id : undefined}
                        onRate={onRate}
                    />
                ) : undefined}

                {/* How long the order has left, which is the question the count never answered.
                    "21 still to come" is forty minutes of a talk-heavy hour or two hours of long
                    records, and an operator deciding whether to go to bed needs the second number.
                    Hedged with "about" because it is: a skip, a drop or a refill moves it. */}
                {dryAt && loaded ? (
                    <Text size="sm" c="dimmed">
                        The order runs dry at about <span className="da-num">{dryAt}</span>. {whatHappensThen(loaded.onEnd)}{' '}
                        {/* Extend lives HERE rather than in the row of buttons above, because this
                            sentence is what makes anybody want it. On a default station it is also
                            mostly redundant — the order tops itself up once it drops below eight —
                            so as a peer of Shuffle and Plan it read as a routine step rather than
                            as the occasional nudge it is: more records now, without waiting for
                            the threshold, after dropping a stretch of the hour. */}
                        <Anchor
                            component="button"
                            type="button"
                            size="sm"
                            disabled={extend.isPending}
                            onClick={() =>
                                extend.mutate({}, { onSuccess: () => notifyQueued('Refill asked for. The records land in a few seconds.') })
                            }
                        >
                            Extend now
                        </Anchor>
                    </Text>
                ) : undefined}
            </Stack>
        </Stack>
    );
}

/**
 * The line beside "Needs you", which changes with the count rather than being decoration.
 *
 * The reassurance is the point of the wording: nothing in this list takes the station off air, and
 * an operator who has learned that reads it without their stomach dropping.
 */
function needsYouBlurb(count: number | undefined): string {
    if (count === undefined) return '';
    if (count === 0) return 'Nothing is waiting on you.';
    return `${count === 1 ? '1 thing' : `${count} things`}, worst first. Nothing here is urgent enough to take the station off air.`;
}
