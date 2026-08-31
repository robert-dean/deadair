import { memo, useCallback, useEffect, useRef, useState, type Ref, type RefObject } from 'react';
import { ActionIcon, Badge, Box, Button, Card, Group, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconArrowBarToUp, IconChevronDown, IconChevronsUp, IconX } from '@tabler/icons-react';
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import type { Rating, StationItemState, StationOrderItem } from '@deadair/sdk';

import { RatingControl } from '../catalog/rating.control';
import { Artwork } from '../shared/artwork';
import { AlbumLink, ArtistLink, ScriptLink, TrackLink } from '../shared/catalog.links';
import { formatDuration } from '../shared/format.duration';
import { usePhone } from '../shared/use.phone';
import classes from './station.order.table.module.css';

export interface StationOrderTableProps {
    items: StationOrderItem[];
    /** Offered on items nobody has been handed yet. Absent means this console cannot drop items at all. */
    onRemove?: (item: StationOrderItem) => void;
    /** Whether a removal is in flight, so the row can say so rather than looking ignored. */
    removingItemId?: string;
    /**
     * Moving an item to a new index. Absent draws no handles.
     *
     * The index is computed here rather than by the caller, because the rule for what is legal is a
     * fact about the rows this component is already holding — see {@link firstPlannedIndex}.
     */
    onMove?: (item: StationOrderItem, toIndex: number) => void;
    /** Whether a move is in flight, on the same terms as {@link removingItemId}. */
    movingItemId?: string;
    /**
     * What the station thinks of the record on a row. Absent draws no rating controls at all.
     *
     * Offered on a SPENT row as well as a planned one, unlike every other control here: the record
     * that just finished is exactly the one an operator has an opinion about, and a rating is about
     * the work rather than about this item's turn in the order.
     */
    onRate?: (trackId: string, rating: Rating) => void;
    /** Which record's rating is being written, so its row can say so rather than looking ignored. */
    ratingTrackId?: string;
    /**
     * Whether the history behind the item on air starts folded away behind a count.
     *
     * The desk turns this on and the On-air page does not, and the difference is what each is for.
     * An hour of played records is how somebody reviewing a broadcast reads where the station got
     * to; on a landing page it is an hour of scrolling in front of the four rows that have not
     * happened yet. Folded rather than dropped — which item was skipped and where is exactly what an
     * operator opens this to find.
     */
    collapseHistory?: boolean;
}

/** `artists.join(', ')`, but without a stray separator when the array is documented-empty. */
function formatArtists(artists: string[]): string {
    return artists.length > 0 ? artists.join(', ') : '';
}

/** Whether an item is beyond editing: the player has it, or it is behind us. */
const isSpent = (state: StationItemState): boolean => state !== 'planned';

/**
 * The lowest position an item may be moved to, and the only one this table ever asks for.
 *
 * `lineup.move` refuses a `toIndex` below what has been committed rather than clamping it, on the
 * grounds that quietly reordering something a listener is about to hear is worse than saying no.
 * The console cannot see that boundary directly — it is the player's, not the order's — but the
 * first `planned` row is always at or above it, because everything ahead of it has either been
 * handed over or is behind us.
 *
 * -1 when there is nothing planned at all, which is a table with no move to offer.
 */
function firstPlannedIndex(items: StationOrderItem[]): number {
    return items.findIndex(item => item.state === 'planned');
}

/**
 * How loud a row is, on the three-way split the running order actually has.
 *
 * Full for what is happening and what is still to come, half for the history an operator reads to
 * see where the station got to, and a quarter for a skipped SEGMENT — which is history that arrives
 * in runs. Four consecutive "News SEGMENT MODEL SKIPPED" lines at the same weight as the records
 * around them read as the running order rather than as the holes in it.
 *
 * Segments only. A skipped RECORD is a single row and is the more interesting fact of the two, since
 * the station had something to play and did not play it.
 */
function opacityFor(item: StationOrderItem): number {
    if (item.state === 'airing' || item.state === 'planned') return 1;
    return item.state === 'skipped' && item.segmentId !== undefined ? 0.25 : 0.5;
}

/**
 * What decided a break's words, in a sentence.
 *
 * Free text on the row rather than a fixed set, because a station can install a writer this console
 * has never heard of. The two it does know are named; anything else is shown as it comes.
 */
function writerHint(writer: string): string {
    if (writer === 'model') return 'A model wrote these words.';
    if (writer === 'deterministic')
        return 'The station wrote these words itself, from its own phrasings. That is the floor: it is also what you hear when a model is off, missing, or too slow.';
    return `Written by ${writer}.`;
}

/**
 * How each state reads to somebody at the desk.
 *
 * The words matter more than they look. "Handed over" is deliberately not "playing": the pusher
 * runs a lead ahead of the listener by design, so an item the player is holding may be two records
 * from being heard, and a console that called it "playing" would be a track ahead of the stream.
 * That mistake is the one this whole shape exists to make unrepresentable.
 */
const STATE_LABEL: Record<StationItemState, { label: string; colour: string; hint: string } | undefined> = {
    planned: undefined,
    handed: {
        label: 'handed over',
        colour: 'gray',
        hint: 'The player is holding this one. It can no longer be moved or removed, and it has not aired yet.',
    },
    airing: { label: 'on air', colour: 'red', hint: 'The player says a listener is hearing this now.' },
    played: { label: 'played', colour: 'gray', hint: 'Heard, and behind us.' },
    skipped: {
        label: 'skipped',
        colour: 'yellow',
        hint: 'The station passed over this one: a segment with no audio, or an item the player never started.',
    },
    // Split out of `skipped` because it is the only one of these an operator can act on. A skip is
    // the station making a decision it was designed to make; this is a record it could not get hold
    // of, which means a copy that would not serve — and the fix is out there, not in here.
    unavailable: {
        label: 'unavailable',
        colour: 'orange',
        hint: 'The station could not get the audio for this record, so it was passed over. Its copy is benched until a sync sees it again — check the record in the catalog to see which provider is refusing it.',
    },
    // Its own state rather than a shade of `skipped`, because it is the opposite fact: nothing
    // went wrong here. Grey rather than yellow for the same reason.
    removed: {
        label: 'removed',
        colour: 'gray',
        hint: 'You took this out. It stays in the order marked like this rather than disappearing, which is what stops the station planting another break into the same slot a minute later.',
    },
};

/**
 * What a row is called, pointing at whichever page can say more about it.
 *
 * The shaping is stated once here rather than at both arms, because the two spellings of a title
 * have to line up in a column: a break and a record sit in the same cell, truncate the same way and
 * take the same weight on air.
 */
function Title({ item, id }: { item: StationOrderItem; id?: string }) {
    const props = { size: 'sm', truncate: true, fw: item.state === 'airing' ? 600 : undefined, style: { minWidth: 0 } } as const;

    return item.kind === 'segment' ? (
        <ScriptLink id={id} {...props}>
            {item.title}
        </ScriptLink>
    ) : (
        <TrackLink id={id} {...props}>
            {item.title}
        </TrackLink>
    );
}

/**
 * Which row the order is read FROM.
 *
 * The item on air when there is one. When there is not — a station stood down, or one that has been
 * put on and has not reached its first record yet — the first item nothing has spent, because "where
 * the station has got to" is the question either way and an operator should not have to hunt for it
 * in a played-out list.
 */
function anchorOf(items: StationOrderItem[]): StationOrderItem | undefined {
    return items.find(item => item.state === 'airing') ?? items.find(item => item.state === 'planned' || item.state === 'handed');
}

/**
 * What the folded history is called, counting only what it actually holds.
 *
 * A broadcast that has only just started has history with nothing skipped in it, and "0 skipped" on
 * the desk is a zero an operator has to read and discard. Each clause appears when there is one.
 */
function historyLabel(played: number, passed: number): string {
    const clauses: string[] = [];
    if (played > 0) clauses.push(played === 1 ? '1 played earlier' : `${played} played earlier`);
    if (passed > 0) clauses.push(passed === 1 ? '1 skipped' : `${passed} skipped`);
    // Neither, and yet there are rows behind the anchor: they are removals and hand-overs, which
    // are the two states that are neither played nor passed over. Naming the count is honest where
    // naming a state would not be.
    return clauses.length > 0 ? clauses.join(', ') : 'Earlier in this broadcast';
}

/**
 * What a row is guessed to cost before it has been measured, in px: the artwork plus the table's
 * `xs` vertical padding. Only ever a first word — every mounted row is measured and the guess
 * replaced — but a guess near the truth is what keeps the first pin from landing a screen away.
 */
const ROW_ESTIMATE = 50;

/**
 * How many rows are mounted beyond each edge of the window.
 *
 * Enough that a smooth scroll's intermediate frames and the one-thead skew of the window (see
 * `pinnedTop`) never show blank rows. It is also a fact the DESK TESTS lean on: at jsdom's
 * zero-height viewport the virtualizer's range is a single row, so a fixture of nine or fewer items
 * mounts whole and the existing suites hold without measurement shims. A larger fixture needs the
 * shims in `tests/components/onair/station.order.table.test.tsx`.
 */
const OVERSCAN = 8;

/** How near the pinned position counts as being back at it, in px. */
const RE_ARM_SLACK = 12;

/** Longest a pin of this hook's own is allowed to still be settling, in ms. */
const PIN_SETTLE_MS = 800;

/**
 * Holds the row that is going out at the top of the table, and lets go when the operator scrolls.
 *
 * The whole point of this page is the item that is on now, and a long order buries it: an hour of
 * played records pushes it off the screen, and every boundary pushes it one row further. So the
 * table scrolls itself so that row sits under the header, and the history stays above it where it
 * can still be read.
 *
 * **It stops following the moment the operator scrolls.** A console that dragged the view back
 * while somebody was reading the tail would be worse than one that never moved. The release is
 * taken from the SCROLL rather than from a wheel, because a dragged scrollbar fires no wheel event
 * and reading the tail with the mouse is exactly how somebody would do it; the cost is that this
 * hook's own scrolling has to be told apart from a person's, which is what `pinning` is for. It
 * re-arms when the anchor is back at the top, whoever put it there.
 */
function usePinnedToAir(
    anchorId: string | undefined,
    anchorIndex: number | undefined,
    itemCount: number,
    virtualizer: Virtualizer<HTMLDivElement, HTMLTableRowElement>,
    portRef: RefObject<HTMLDivElement | null>,
) {
    const [following, setFollowing] = useState(true);
    // The first pin is the page arriving at a running order already in progress, which should not
    // read as an animation of something that just happened.
    const settled = useRef(false);

    /**
     * Where the port would have to be scrolled for the anchor row to sit under the header.
     *
     * Arithmetic over the virtualizer's offsets rather than a measurement of the row, because with
     * the table windowed the anchor row need not be mounted at all — which is exactly the state the
     * re-arm below has to reason about, an operator away in the tail with the anchor scrolled out.
     *
     * The thead never appears in this sum, and that is a cancellation rather than an omission: the
     * virtualizer's offsets start at the top of the tbody, which sits one thead below the top of the
     * scroll content, and the pin target is the anchor one thead below the top of the viewport. The
     * two theads cancel, so the anchor's own offset IS the scroll position — the same reason the
     * virtualizer needs no `scrollMargin`, since the rows its window is off by are exactly the rows
     * hidden under the sticky header, and overscan covers the difference besides.
     */
    const pinnedTop = useCallback((): number | undefined => {
        if (anchorIndex === undefined) return undefined;
        const offset = virtualizer.getOffsetForIndex(anchorIndex, 'start');
        return offset === undefined ? undefined : Math.max(0, offset[0]);
    }, [anchorIndex, virtualizer]);

    // Whether the scroll now under way is this hook's own. A smooth scroll arrives as a run of
    // scroll events at positions that are not the pinned one, and without this every one of them
    // would read as the operator scrolling away. The timer is the backstop rather than the
    // mechanism: an animation that is interrupted never reaches its target and would otherwise
    // leave this stuck on, and a hook stuck on is a table that can never be scrolled off air.
    const pinning = useRef<number | undefined>(undefined);
    const holdPinning = useCallback(() => {
        window.clearTimeout(pinning.current);
        pinning.current = window.setTimeout(() => {
            pinning.current = undefined;
        }, PIN_SETTLE_MS);
    }, []);

    const pin = useCallback(
        (behavior: ScrollBehavior) => {
            const top = pinnedTop();
            if (top === undefined) return;
            holdPinning();
            // A smooth scroll is an animation, and a browser runs no animation frames for a tab
            // nobody is looking at: asking for one there moves nothing at all. A console left open
            // on another tab is the ordinary case here, so the jump is taken instead — there is
            // nobody to see it, which is the same reason the animation was wanted.
            portRef.current?.scrollTo({ top, behavior: behavior === 'smooth' && !document.hidden ? 'smooth' : 'auto' });
            setFollowing(true);
        },
        [pinnedTop, holdPinning, portRef],
    );

    useEffect(
        () => () => {
            window.clearTimeout(pinning.current);
        },
        [],
    );

    // `itemCount` as well as the anchor: a refill lands, a cut splices, and the row keeps its id
    // while everything under it moves.
    useEffect(() => {
        if (!following || anchorId === undefined) return;
        pin(settled.current ? 'smooth' : 'auto');
        settled.current = true;
    }, [anchorId, itemCount, following, pin]);

    // A pin is arithmetic over the CURRENT heights of everything above the anchor, and those keep
    // moving after the effect above has run: every row above carries a sleeve that arrives from the
    // network, and a row is shorter until its image lands. Measured on this station, that left the
    // anchor a row low. The old shape watched the table with a ResizeObserver; with the rows
    // windowed the virtualizer is already the thing doing the measuring, so its total size is the
    // one number that moves whenever any mounted row changes height — the artwork, a wrapped title
    // on a narrow window and the window being resized, all as one fact. It is also the
    // self-correction for the windowing itself: a pin lands on estimated offsets, the rows around
    // the landing point mount and measure, the total shifts, and the pin is retaken exactly.
    // `following` is mirrored into a ref so a pin that just SET it does not immediately re-run this
    // effect and turn its own smooth scroll into a jump.
    const totalSize = virtualizer.getTotalSize();
    const followingNow = useRef(following);
    useEffect(() => {
        followingNow.current = following;
    }, [following]);
    useEffect(() => {
        if (!followingNow.current) return;
        // A jump while parked is invisible; a jump while one of this hook's own smooth scrolls is
        // in flight is not, and rows measuring as the animation passes them is the ordinary way
        // this fires mid-flight. Retargeting the animation keeps it an animation.
        pin(pinning.current === undefined ? 'auto' : 'smooth');
    }, [totalSize, pin]);

    return {
        /** Offered as a control only when there is something to go back TO. */
        pinnable: anchorId !== undefined && !following,
        pin,
        handlers: {
            onScroll: () => {
                const top = pinnedTop();
                if (top === undefined) return;
                if (Math.abs((portRef.current?.scrollTop ?? 0) - top) <= RE_ARM_SLACK) {
                    // Landed. Whoever was scrolling, the anchor is where it belongs.
                    window.clearTimeout(pinning.current);
                    pinning.current = undefined;
                    setFollowing(true);
                } else if (pinning.current === undefined) {
                    setFollowing(false);
                }
            },
        },
    };
}

/**
 * The live running order, item by item, each saying where it has got to.
 *
 * Presentational: it owns no queries and decides nothing about what an edit means. The state is the
 * API's own answer to whether an item can still be acted on — anything but `planned` answers 422 to
 * every edit — so the controls follow it rather than a rule restated here.
 *
 * There is no cursor line to draw any more, and that is the point rather than a simplification: the
 * position used to be an integer that could disagree with what actually aired, and it is now a fact
 * on each item that the player itself reported.
 */
export function StationOrderTable({
    items,
    onRemove,
    removingItemId,
    onMove,
    movingItemId,
    onRate,
    ratingTrackId,
    collapseHistory = false,
}: StationOrderTableProps) {
    const editable = onRemove !== undefined || onMove !== undefined;
    const nextUp = firstPlannedIndex(items);
    const anchor = anchorOf(items);
    const [historyOpen, setHistoryOpen] = useState(false);
    // `false` while unknown, which is the desk: a table drawn for a frame and replaced is cheaper
    // than a phone layout flashing on every desktop load. The hook carries that fallback.
    const phone = usePhone();

    // Everything before the row the order is read from. Taken by POSITION rather than by state,
    // because that is what "behind us" means here: a removed item sitting among the planned ones is
    // still ahead, and folding it away would hide the row that explains why a slot is empty.
    const anchorAt = anchor ? items.indexOf(anchor) : -1;
    const folding = collapseHistory && !historyOpen && anchorAt > 0;
    const history = folding ? items.slice(0, anchorAt) : [];
    const shown = folding ? items.slice(anchorAt) : items;

    // Counted off the folded rows themselves, so the sentence cannot disagree with what opening it
    // reveals. `skipped` and `unavailable` are one word here: an operator deciding whether to look
    // wants to know something did not play, and the row says which of the two it was.
    const played = history.filter(item => item.state === 'played').length;
    const passed = history.filter(item => item.state === 'skipped' || item.state === 'unavailable').length;

    const portRef = useRef<HTMLDivElement>(null);
    // Only a window of rows is mounted: a rotation order is forty-odd rows, but a setlist replays a
    // whole playlist and never trims its past, and an operator opening the desk on one should not
    // pay for eight hundred rows of artwork and badges to read the four that fit on screen.
    //
    // The suppressed warning is advisory about the React Compiler, which this build does not run;
    // the rows are memoised by hand instead.
    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
        count: shown.length,
        getScrollElement: () => portRef.current,
        estimateSize: () => ROW_ESTIMATE,
        overscan: OVERSCAN,
        // What the port is assumed to measure before it has been measured, which is only the very
        // first render: without it that render works from a rect of zero and mounts an empty
        // tbody, a flash of no table at all before the effect that measures has run. The height is
        // the port's own `max-height` floor. It does not survive measurement anywhere — including
        // under jsdom, which measures every element at zero; the tests that want mounted rows give
        // the port a height instead (`tests/utils/order.port.ts`).
        initialRect: { width: 780, height: 320 },
        // The item's id rather than its index, so a measured height survives the splices that move
        // every index at once: the fold opening, and a refill landing behind the anchor.
        getItemKey: index => shown[index]!.id,
        // The fallback is production-real rather than a test crutch: on a phone the port is
        // `display: none` and every mounted row measures zero, and a zero once cached would still
        // be the row's height when the window widens back to the desk.
        measureElement: element => {
            const height = element.getBoundingClientRect().height;
            return height > 0 ? height : ROW_ESTIMATE;
        },
    });
    const { pinnable, pin, handlers } = usePinnedToAir(anchor?.id, anchor ? (folding ? 0 : anchorAt) : undefined, items.length, virtualizer, portRef);

    const virtualItems = virtualizer.getVirtualItems();
    // What the unmounted rows would have occupied, held by a spacer row at each end so the
    // scrollbar and every offset read as if the whole order were mounted.
    const padTop = virtualItems.length > 0 ? virtualItems[0]!.start : 0;
    const padBottom = virtualItems.length > 0 ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end : 0;
    const columns = 5 + (onRate ? 1 : 0) + (editable ? 1 : 0);

    return (
        // Scrolled inside its own box rather than by the page, on both axes. The row is genuinely
        // wide — a title, its badges, a credit, a record and a rating — and without this the whole
        // console slides sideways, taking the nav and the transport with it, which is the one thing
        // that must stay put while an operator is reading a fault. The vertical bound is what lets
        // the order be held against the item on air rather than against the top of the document.
        <Box pos="relative">
            {/* Above the table rather than as a first row, so it survives the port's own scrolling
                and stays where an operator left it. */}
            {folding ? (
                <Button
                    variant="subtle"
                    color="gray"
                    size="compact-sm"
                    fullWidth
                    justify="flex-start"
                    rightSection={<IconChevronDown size={14} stroke={1.8} />}
                    onClick={() => setHistoryOpen(true)}
                    aria-expanded={false}
                >
                    {historyLabel(played, passed)}
                </Button>
            ) : undefined}
            {/* The phone gets rows rather than a table that scrolls sideways. Six columns at 375px
                is a horizontal scrollbar under a vertical one, and the two facts somebody checks
                from bed — what is on, and what is next — are the two that end up off the right edge.
                Same data, same order, same states; only the shape differs.

                Chosen with a media QUERY rather than `hiddenFrom`, which would leave both in the
                document: an hour of running order rendered twice is a real cost on the device least
                able to pay it, and every title would answer to a query twice over. */}
            {phone ? (
                <Stack gap={6}>
                    {shown.map(item => (
                        <PhoneRow
                            key={item.id}
                            item={item}
                            // The handler itself rather than a closure over it, so an unchanged row
                            // survives the memo comparison across the five-second poll.
                            onRemove={onRemove && !isSpent(item.state) ? onRemove : undefined}
                            removing={removingItemId === item.id}
                        />
                    ))}
                </Stack>
            ) : undefined}

            <Box
                ref={portRef}
                className={classes.port}
                display={phone ? 'none' : undefined}
                // Focusable so the scroll keys reach it at all, and named so a screen reader says
                // what the region is before reading an hour of it.
                tabIndex={0}
                role="region"
                aria-label="Running order"
                {...handlers}
            >
                {/* `layout="fixed"` because only a window of rows is mounted: under the default
                    auto layout every column is sized from the content that happens to be on
                    screen, so scrolling would re-measure the table and the columns would breathe.
                    Fixed layout sizes them from the header row once; Title takes its share
                    explicitly and the credit and album split what the fixed columns leave. */}
                <Table highlightOnHover verticalSpacing="xs" miw={780} stickyHeader stickyHeaderOffset={0} layout="fixed">
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th w={40}>#</Table.Th>
                            <Table.Th w="40%">Title</Table.Th>
                            <Table.Th>Artists</Table.Th>
                            <Table.Th visibleFrom="xl">Album</Table.Th>
                            <Table.Th w={90}>Duration</Table.Th>
                            {onRate ? <Table.Th w={112}>Rating</Table.Th> : undefined}
                            {editable ? <Table.Th w={onMove ? 96 : 60} /> : undefined}
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {padTop > 0 ? (
                            <Table.Tr aria-hidden className={classes.spacer}>
                                <Table.Td colSpan={columns} style={{ height: padTop }} />
                            </Table.Tr>
                        ) : undefined}
                        {virtualItems.map(row => {
                            const item = shown[row.index]!;
                            return (
                                <OrderRow
                                    key={row.key}
                                    // How the virtualizer finds its way back from the element to the
                                    // item it measured, and the ref is what does the measuring.
                                    data-index={row.index}
                                    ref={virtualizer.measureElement}
                                    item={item}
                                    // Where this row sits in the WHOLE order rather than in the
                                    // visible slice, which is the number both the row's own count
                                    // and the move it offers are stated against.
                                    position={row.index + (folding ? anchorAt : 0)}
                                    nextUp={nextUp}
                                    editable={editable}
                                    onRemove={onRemove}
                                    removing={removingItemId === item.id}
                                    onMove={onMove}
                                    moving={movingItemId === item.id}
                                    onRate={onRate}
                                    writingRating={item.kind === 'track' && ratingTrackId === item.trackId}
                                />
                            );
                        })}
                        {padBottom > 0 ? (
                            <Table.Tr aria-hidden className={classes.spacer}>
                                <Table.Td colSpan={columns} style={{ height: padBottom }} />
                            </Table.Tr>
                        ) : undefined}
                    </Table.Tbody>
                </Table>
            </Box>
            {/* The way back, and it is only ever drawn when the operator has gone somewhere else:
                a button that undoes nothing is a button that teaches an operator to ignore this
                corner of the screen.

                Over the TOP of the table rather than the bottom, which is where it started: the
                box is as tall as the window allows and the page under it is long, so its bottom
                edge is regularly below the fold and behind the transport, where a control is a
                control nobody has. The top edge is on screen whenever the table is being read at
                all. It covers a column heading while it shows, which is the cheapest thing on the
                page to cover, and it is drawn over the header rather than above it so that nothing
                on the page moves when it appears. */}
            {pinnable ? (
                <Button
                    size="compact-sm"
                    variant="filled"
                    color="dark"
                    leftSection={<IconArrowBarToUp size={14} stroke={1.8} />}
                    onClick={() => pin('smooth')}
                    style={{ position: 'absolute', top: 4, right: 'var(--mantine-spacing-md)', zIndex: 5 }}
                >
                    Back to what is on air
                </Button>
            ) : undefined}
        </Box>
    );
}

interface OrderRowProps {
    item: StationOrderItem;
    /** Where the item sits in the WHOLE order, not in the visible slice. */
    position: number;
    /** {@link firstPlannedIndex} of the whole order, which is the only index a move ever targets. */
    nextUp: number;
    /** Whether the table is drawing the edit column at all, so an uneditable row still lines up. */
    editable: boolean;
    onRemove?: (item: StationOrderItem) => void;
    removing: boolean;
    onMove?: (item: StationOrderItem, toIndex: number) => void;
    moving: boolean;
    onRate?: (trackId: string, rating: Rating) => void;
    writingRating: boolean;
    /** How the virtualizer's measurement finds the item this element belongs to. */
    'data-index': number;
    ref?: Ref<HTMLTableRowElement>;
}

/**
 * One desktop row of the running order.
 *
 * Memoised because the order is re-fetched every five seconds and almost nothing on it changes
 * between polls: the query's structural sharing keeps an unchanged item's identity, so an unchanged
 * row costs a comparison rather than a render of a title, three badges, two links and a rating
 * control. The busy flags are computed by the parent so that one flipping re-renders one row.
 */
const OrderRow = memo(function OrderRow({
    item,
    position,
    nextUp,
    editable,
    onRemove,
    removing,
    onMove,
    moving,
    onRate,
    writingRating,
    'data-index': dataIndex,
    ref,
}: OrderRowProps) {
    const state = STATE_LABEL[item.state];
    // A segment is the station's own words, and a record the catalog has never seen
    // has no row to hold an opinion — a station can air one it never ingested.
    const trackId = item.kind === 'track' ? item.trackId : undefined;
    return (
        <Table.Tr
            ref={ref}
            data-index={dataIndex}
            className={item.state === 'airing' ? classes.airing : undefined}
            // Dimmed rather than hidden: what is beyond editing is how an operator
            // reads where the station has got to. The item ON AIR is not dimmed,
            // because it is the one thing on the page that is happening.
            //
            // A SKIPPED segment is dimmed further still, which is not a third
            // opinion about states but a fact about how they arrive: a played
            // record is one row and a break the station passed over comes in
            // runs, four and five deep, each one an identical line saying News
            // SEGMENT MODEL SKIPPED. At the same weight as the history around
            // them they read as the order rather than as the gaps in it. The row
            // stays a row, because which break was skipped and where is exactly
            // what an operator scrolls back to find.
            opacity={opacityFor(item)}
        >
            <Table.Td>
                {/* Numbered against the WHOLE order rather than the rows on
                                            screen: with the history folded away, a first visible row
                                            called 1 would quietly renumber the broadcast. */}
                <Text size="xs" c="dimmed" className="da-num">
                    {position + 1}
                </Text>
            </Table.Td>
            <Table.Td>
                {/* `minWidth: 0` in both places, and both are load-bearing: a flex
                                        child defaults to `min-width: auto`, so a truncating title
                                        would otherwise refuse to shrink inside its fixed column and
                                        overflow it instead. The Group needs it to be shrinkable at
                                        all; the Text needs it to be the thing that gives. */}
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    <Artwork src={item.artworkUrl} alt={item.title} size={28} radius="xs" />
                    {/* The way into whatever this row IS, which is where an
                                            operator hearing something odd actually wants to go: a
                                            record goes to everything it has accumulated and a break
                                            goes to the words it was written from. Both draw as the
                                            same plain text they always were when there is nothing
                                            to reach — an uningested record, a segment the library
                                            no longer holds. */}
                    <Title item={item} id={item.kind === 'segment' ? item.segmentId : trackId} />
                    {/* A segment is not a record and should not have to be worked
                                            out from an empty artist column. */}
                    {item.kind === 'segment' ? (
                        <Badge size="xs" variant="light" color="grape" style={{ flexShrink: 0 }}>
                            segment
                        </Badge>
                    ) : undefined}
                    {/* A talk-over never becomes something the player is handed: it
                                            is heard ALONGSIDE the record after it, with the music
                                            ducked under it. */}
                    {item.overAtMs === undefined ? undefined : (
                        <Badge size="xs" variant="light" color="grape" style={{ flexShrink: 0 }}>
                            over the next record
                        </Badge>
                    )}
                    {/* Which writer produced the words. Without it a model that
                                            degrades to the station's own phrasings on every single
                                            break looks exactly like a model that is working, and the
                                            answer has been on the row since it was written. */}
                    {item.segmentWriter === undefined ? undefined : (
                        <Tooltip label={writerHint(item.segmentWriter)} multiline maw={360}>
                            <Badge size="xs" variant="light" color={item.segmentWriter === 'model' ? 'grape' : 'gray'} style={{ flexShrink: 0 }}>
                                {item.segmentWriter}
                            </Badge>
                        </Tooltip>
                    )}
                    {/* The station SKIPS a segment that has no audio when it comes
                                            round, rather than waiting for one. An operator reading the
                                            order has to be able to see which items will not be heard. */}
                    {item.kind === 'segment' && item.playable === false && item.state === 'planned' ? (
                        // The reason when the row carries one. A break that could
                        // not be written and a DJ that simply talks less look
                        // identical without it, and the difference is a sentence
                        // already on the segment.
                        <Tooltip
                            multiline
                            maw={360}
                            label={item.segmentError ?? `This will be skipped: the segment is ${item.segmentState ?? 'unavailable'}`}
                        >
                            <Badge size="xs" variant="light" color="yellow" style={{ flexShrink: 0 }}>
                                will skip
                            </Badge>
                        </Tooltip>
                    ) : undefined}
                    {state ? (
                        <Tooltip label={state.hint} multiline maw={360}>
                            {/* Mono, like every other legend on the desk, and pulsing on the one
                                                    row that is actually going out. */}
                            <Text
                                size="xs"
                                c={state.colour}
                                ff="monospace"
                                tt="uppercase"
                                className={item.state === 'airing' ? 'da-lamp-pulse' : undefined}
                                style={{ letterSpacing: 'var(--da-tracking-eyebrow)', whiteSpace: 'nowrap', flexShrink: 0 }}
                            >
                                {state.label}
                            </Text>
                        </Tooltip>
                    ) : undefined}
                </Group>
            </Table.Td>
            {/* The CREDIT is drawn and the LEAD is linked, which is the same
                                    split the rest of the station runs on: `artists` is what the
                                    provider wrote on the copy and `artistId` is who it is by.

                                    `dimmed` only where there is nowhere to go, because a dimmed
                                    anchor is indistinguishable from the text beside it: a link
                                    nobody can see is a page nobody finds, which is the reason the
                                    catalog's own table draws these two as links at all. */}
            <Table.Td>
                <ArtistLink id={item.artistId} size="sm" c={item.artistId === undefined ? 'dimmed' : undefined} truncate>
                    {formatArtists(item.artists)}
                </ArtistLink>
            </Table.Td>
            <Table.Td visibleFrom="xl">
                <AlbumLink id={item.albumId} size="sm" c={item.albumId === undefined ? 'dimmed' : undefined} truncate>
                    {item.album ?? ''}
                    {item.year ? ` (${item.year})` : ''}
                </AlbumLink>
            </Table.Td>
            <Table.Td>
                <Text size="xs" c="dimmed" className="da-num">
                    {formatDuration(item.durationMs)}
                </Text>
            </Table.Td>
            {onRate ? (
                <Table.Td>
                    {trackId === undefined ? undefined : (
                        <RatingControl
                            size="xs"
                            rating={item.rating}
                            label={item.title}
                            busy={writingRating}
                            onChange={rating => {
                                onRate(trackId, rating);
                            }}
                        />
                    )}
                </Table.Td>
            ) : undefined}
            {editable ? (
                <Table.Td>
                    <Group gap={2} wrap="nowrap">
                        {/* Not on the row already at the front: a control
                                                whose only effect is to leave the order exactly as
                                                it was teaches an operator that this corner of the
                                                row does nothing, which is the same argument the
                                                spent rows below are drawn bare on. */}
                        {onMove && item.state === 'planned' && position !== nextUp ? (
                            <Tooltip
                                label="Moves this in front of everything the player is not already holding. Not necessarily the next thing heard: whatever has been handed over plays first."
                                multiline
                                maw={340}
                            >
                                <ActionIcon
                                    variant="subtle"
                                    color="gray"
                                    aria-label={`Play ${item.title} next`}
                                    loading={moving}
                                    onClick={() => onMove(item, nextUp)}
                                >
                                    <IconChevronsUp size={15} stroke={1.8} />
                                </ActionIcon>
                            </Tooltip>
                        ) : undefined}
                        {/* Nothing at all on a spent item, rather than a disabled
                                            control: the player is holding it or it is behind us, and an
                                            affordance that could only ever answer 422 is worse than no
                                            affordance. */}
                        {onRemove && !isSpent(item.state) ? (
                            <Tooltip label="Drop this item">
                                <ActionIcon
                                    variant="subtle"
                                    color="red"
                                    aria-label={`Drop ${item.title}`}
                                    loading={removing}
                                    onClick={() => onRemove(item)}
                                >
                                    <IconX size={15} stroke={1.8} />
                                </ActionIcon>
                            </Tooltip>
                        ) : undefined}
                    </Group>
                </Table.Td>
            ) : undefined}
        </Table.Tr>
    );
});

/**
 * One item of the running order, on a phone.
 *
 * Deliberately not the table's row with columns hidden. What survives a 375px width is a different
 * SELECTION, not a narrower one: the state matters more than the album, the duration matters more
 * than the credit, and the artwork earns its place because it is how somebody recognises a record
 * at a glance. A row that dropped columns until it fit would keep the ones that happened to be
 * leftmost.
 */
const PhoneRow = memo(function PhoneRow({
    item,
    onRemove,
    removing,
}: {
    item: StationOrderItem;
    onRemove?: (item: StationOrderItem) => void;
    removing: boolean;
}) {
    const state = STATE_LABEL[item.state];
    const airing = item.state === 'airing';

    return (
        <Card
            withBorder={false}
            padding="xs"
            radius="sm"
            opacity={opacityFor(item)}
            style={{
                background: airing ? 'var(--da-raised)' : 'transparent',
                boxShadow: airing ? 'inset 3px 0 0 var(--mantine-color-red-6)' : undefined,
            }}
        >
            <Group gap="sm" wrap="nowrap">
                <Artwork src={item.artworkUrl} alt={item.title} size={36} radius="xs" />
                <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                        <Text size="sm" fw={airing ? 600 : 400} truncate>
                            {item.title}
                        </Text>
                        {item.kind === 'segment' ? (
                            <Badge size="xs" variant="light" color="grape" style={{ flexShrink: 0 }}>
                                segment
                            </Badge>
                        ) : undefined}
                    </Group>
                    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                        <Text size="xs" c="dimmed" truncate>
                            {formatArtists(item.artists)}
                        </Text>
                        {state ? (
                            <Text
                                size="xs"
                                c={state.colour}
                                ff="monospace"
                                tt="uppercase"
                                style={{ letterSpacing: 'var(--da-tracking-eyebrow)', whiteSpace: 'nowrap', flexShrink: 0 }}
                            >
                                {state.label}
                            </Text>
                        ) : undefined}
                    </Group>
                </Stack>
                <Text size="xs" c="dimmed" className="da-num" style={{ flexShrink: 0 }}>
                    {formatDuration(item.durationMs)}
                </Text>
                {/* 44px, because this is the one destructive control on a surface being used with a
                    thumb. Nothing at all on a spent item, rather than a disabled affordance that
                    could only ever answer 422. */}
                {onRemove ? (
                    <ActionIcon
                        variant="subtle"
                        color="red"
                        w={44}
                        h={44}
                        aria-label={`Drop ${item.title}`}
                        loading={removing}
                        onClick={() => onRemove(item)}
                    >
                        <IconX size={16} stroke={1.8} />
                    </ActionIcon>
                ) : undefined}
            </Group>
        </Card>
    );
});
