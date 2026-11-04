import { useRef, useState } from 'react';
import { Box, Button, Stack, Table } from '@mantine/core';
import { IconArrowBarToUp, IconChevronDown } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { Rating, ScriptRating, StationOrderItem } from '@deadair/sdk';

import { usePhone } from '../shared/use.phone';
import { OrderRow, PhoneRow } from './station.order.rows';
import { anchorOf, canRewrite, canSkipTo, firstPlannedIndex, historyLabel, isSpent } from './station.order.rules';
import classes from './station.order.table.module.css';
import { usePinnedToAir } from './use.pinned.to.air';

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
     * Jumping the station straight to a record, passing over everything in front of it. Absent draws
     * no skip controls.
     *
     * Offered on a record the player is already holding as well as a planned one, unlike a move or a
     * drop: reaching past what the player holds is the whole point of it. See {@link canSkipTo}.
     */
    onSkipTo?: (item: StationOrderItem) => void;
    /** Whether a skip is in flight, on the same terms as {@link removingItemId}. */
    skippingToItemId?: string;
    /**
     * Having a break still to come written again from nothing. Absent draws no rewrite controls.
     *
     * Offered only where the API can say yes: see {@link canRewrite}.
     */
    onRewrite?: (item: StationOrderItem) => void;
    /** Whether a rewrite is in flight, on the same terms as {@link removingItemId}. */
    rewritingItemId?: string;
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
     * What the operator thought of the words on a break's row, in the same column as a record's
     * rating. Absent draws no controls on a break. Offered on a spent row for the same reason.
     */
    onRateScript?: (scriptId: string, rating: ScriptRating) => void;
    /** Which attempt's rating is being written, on the same terms as {@link ratingTrackId}. */
    ratingScriptId?: string;
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
    onSkipTo,
    skippingToItemId,
    onRewrite,
    rewritingItemId,
    onRate,
    ratingTrackId,
    onRateScript,
    ratingScriptId,
    collapseHistory = false,
}: StationOrderTableProps) {
    const { t } = useTranslation('onair');
    const editable = onRemove !== undefined || onMove !== undefined || onSkipTo !== undefined || onRewrite !== undefined;
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
                            onSkipTo={onSkipTo && canSkipTo(item) ? onSkipTo : undefined}
                            skippingTo={skippingToItemId === item.id}
                            onRewrite={onRewrite && canRewrite(item) ? onRewrite : undefined}
                            rewriting={rewritingItemId === item.id}
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
                aria-label={t('order.region')}
                {...handlers}
            >
                {/* `layout="fixed"` because only a window of rows is mounted: under the default
                    auto layout every column is sized from the content that happens to be on
                    screen, so scrolling would re-measure the table and the columns would breathe.
                    Fixed layout sizes them from the header row once.

                    The CREDIT takes a share of its own rather than whatever is left. Left to the
                    residual it settled at 120px on a 1200px window, which is narrower than plenty
                    of real credits — "Tyler, The Creator, Kali Uchis" wants 188 — and an overflowing
                    cell in a fixed layout does not truncate, it prints over the column beside it. So
                    two records in the first four were writing their artists across the running
                    time. Album has no share because it is not drawn at all below `xl`; above it,
                    what these two leave is its. */}
                <Table highlightOnHover verticalSpacing="xs" miw={780} stickyHeader stickyHeaderOffset={0} layout="fixed">
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th w={40}>#</Table.Th>
                            <Table.Th w="36%">{t('order.column.title')}</Table.Th>
                            <Table.Th w="24%">{t('order.column.artists')}</Table.Th>
                            <Table.Th visibleFrom="xl">{t('order.column.album')}</Table.Th>
                            <Table.Th w={90}>{t('order.column.duration')}</Table.Th>
                            {onRate ? <Table.Th w={112}>{t('order.column.rating')}</Table.Th> : undefined}
                            {editable ? <Table.Th w={60 + (onMove ? 36 : 0) + (onSkipTo ? 32 : 0) + (onRewrite ? 32 : 0)} /> : undefined}
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
                                    onSkipTo={onSkipTo}
                                    skippingTo={skippingToItemId === item.id}
                                    onRewrite={onRewrite}
                                    rewriting={rewritingItemId === item.id}
                                    onRate={onRate}
                                    writingRating={item.kind === 'track' && ratingTrackId === item.trackId}
                                    onRateScript={onRateScript}
                                    writingScriptRating={item.kind === 'segment' && ratingScriptId !== undefined && ratingScriptId === item.scriptId}
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
                    {t('order.backToAir')}
                </Button>
            ) : undefined}
        </Box>
    );
}
