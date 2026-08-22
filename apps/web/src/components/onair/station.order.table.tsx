import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Badge, Box, Button, Group, Table, Text, Tooltip } from '@mantine/core';
import { IconArrowBarToUp, IconX } from '@tabler/icons-react';
import type { Rating, StationItemState, StationOrderItem } from '@deadair/sdk';

import { RatingControl } from '../catalog/rating.control';
import { Artwork } from '../shared/artwork';
import { AlbumLink, ArtistLink, ScriptLink, TrackLink } from '../shared/catalog.links';
import { formatDuration } from '../shared/format.duration';
import classes from './station.order.table.module.css';

export interface StationOrderTableProps {
    items: StationOrderItem[];
    /** Offered on items nobody has been handed yet. Absent means this console cannot drop items at all. */
    onRemove?: (item: StationOrderItem) => void;
    /** Whether a removal is in flight, so the row can say so rather than looking ignored. */
    removingItemId?: string;
    /** Moving an item to a new index. Absent draws no handles. */
    onMove?: (item: StationOrderItem, toIndex: number) => void;
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
}

/** `artists.join(', ')`, but without a stray separator when the array is documented-empty. */
function formatArtists(artists: string[]): string {
    return artists.length > 0 ? artists.join(', ') : '';
}

/** Whether an item is beyond editing: the player has it, or it is behind us. */
const isSpent = (state: StationItemState): boolean => state !== 'planned';

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
function usePinnedToAir(anchorId: string | undefined, itemCount: number) {
    const portRef = useRef<HTMLDivElement>(null);
    const headRef = useRef<HTMLTableSectionElement>(null);
    const anchorRef = useRef<HTMLTableRowElement>(null);
    const [following, setFollowing] = useState(true);
    // The first pin is the page arriving at a running order already in progress, which should not
    // read as an animation of something that just happened.
    const settled = useRef(false);

    /** Where the port would have to be scrolled for the anchor row to sit under the header. */
    const pinnedTop = useCallback((): number | undefined => {
        const port = portRef.current;
        const row = anchorRef.current;
        if (!port || !row) return undefined;
        const head = headRef.current?.getBoundingClientRect().height ?? 0;
        return Math.max(0, row.getBoundingClientRect().top - port.getBoundingClientRect().top + port.scrollTop - head);
    }, []);

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
        [pinnedTop, holdPinning],
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
    // anchor a row low. So the table's own size is watched and the pin retaken, which covers the
    // artwork, a wrapped title on a narrow window and the window being resized, all as one fact.
    // Mirrored into a ref so the observer below reads the live answer without being torn down and
    // rebuilt every time it changes.
    const followingNow = useRef(following);
    useEffect(() => {
        followingNow.current = following;
    }, [following]);
    useEffect(() => {
        const content = portRef.current?.firstElementChild;
        if (!content) return;
        const observer = new ResizeObserver(() => {
            if (followingNow.current) pin('auto');
        });
        observer.observe(content);
        return () => {
            observer.disconnect();
        };
    }, [pin]);

    return {
        portRef,
        headRef,
        anchorRef,
        following,
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
export function StationOrderTable({ items, onRemove, removingItemId, onMove, onRate, ratingTrackId }: StationOrderTableProps) {
    const editable = onRemove !== undefined || onMove !== undefined;
    const anchor = anchorOf(items);
    // Destructured rather than kept as one object: the refs have to reach `ref=` as plain
    // identifiers for the hooks lint to see them as refs rather than as a read during render.
    const { portRef, headRef, anchorRef, pinnable, pin, handlers } = usePinnedToAir(anchor?.id, items.length);

    return (
        // Scrolled inside its own box rather than by the page, on both axes. The row is genuinely
        // wide — a title, its badges, a credit, a record and a rating — and without this the whole
        // console slides sideways, taking the nav and the transport with it, which is the one thing
        // that must stay put while an operator is reading a fault. The vertical bound is what lets
        // the order be held against the item on air rather than against the top of the document.
        <Box pos="relative">
            <Box
                ref={portRef}
                className={classes.port}
                // Focusable so the scroll keys reach it at all, and named so a screen reader says
                // what the region is before reading an hour of it.
                tabIndex={0}
                role="region"
                aria-label="Running order"
                {...handlers}
            >
                <Table highlightOnHover verticalSpacing="xs" miw={780} stickyHeader stickyHeaderOffset={0}>
                    <Table.Thead ref={headRef}>
                        <Table.Tr>
                            <Table.Th w={40}>#</Table.Th>
                            <Table.Th>Title</Table.Th>
                            <Table.Th>Artists</Table.Th>
                            <Table.Th visibleFrom="xl">Album</Table.Th>
                            <Table.Th w={90}>Duration</Table.Th>
                            {onRate ? <Table.Th w={112}>Rating</Table.Th> : undefined}
                            {editable ? <Table.Th w={60} /> : undefined}
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {items.map((item, index) => {
                            const state = STATE_LABEL[item.state];
                            // A segment is the station's own words, and a record the catalog has never seen
                            // has no row to hold an opinion — a station can air one it never ingested.
                            const trackId = item.kind === 'track' ? item.trackId : undefined;
                            return (
                                <Table.Tr
                                    key={item.id}
                                    // The row the table holds at the top. A ref rather than an id lookup
                                    // because it is the measured height of everything above it that the
                                    // scroll needs, and only the element carries that.
                                    ref={item.id === anchor?.id ? anchorRef : undefined}
                                    className={item.state === 'airing' ? classes.airing : undefined}
                                    // Dimmed rather than hidden: what is beyond editing is how an operator
                                    // reads where the station has got to. The item ON AIR is not dimmed,
                                    // because it is the one thing on the page that is happening.
                                    opacity={item.state === 'airing' || item.state === 'planned' ? 1 : 0.5}
                                >
                                    <Table.Td>
                                        <Text size="xs" c="dimmed" className="da-num">
                                            {index + 1}
                                        </Text>
                                    </Table.Td>
                                    {/* `maxWidth` rather than `minWidth` is what actually caps this: a table
                                    column sizes to its content, so an upper bound on the cell is the
                                    only thing the layout algorithm will honour, and the `minWidth: 0`
                                    below is what then makes the title the part that gives. */}
                                    <Table.Td style={{ maxWidth: 430 }}>
                                        {/* `minWidth: 0` in both places, and both are load-bearing: a flex
                                        child defaults to `min-width: auto`, so a truncating title
                                        still reports its full width to the table's column algorithm
                                        and the row grows instead of the text shrinking. The Group
                                        needs it to be shrinkable at all; the Text needs it to be the
                                        thing that gives. */}
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
                                                    <Badge
                                                        size="xs"
                                                        variant="light"
                                                        color={item.segmentWriter === 'model' ? 'grape' : 'gray'}
                                                        style={{ flexShrink: 0 }}
                                                    >
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
                                                    label={
                                                        item.segmentError ??
                                                        `This will be skipped: the segment is ${item.segmentState ?? 'unavailable'}`
                                                    }
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
                                    <Table.Td style={{ maxWidth: 220 }}>
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
                                                    busy={ratingTrackId === trackId}
                                                    onChange={rating => {
                                                        onRate(trackId, rating);
                                                    }}
                                                />
                                            )}
                                        </Table.Td>
                                    ) : undefined}
                                    {editable ? (
                                        <Table.Td>
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
                                                        loading={removingItemId === item.id}
                                                        onClick={() => onRemove(item)}
                                                    >
                                                        <IconX size={15} stroke={1.8} />
                                                    </ActionIcon>
                                                </Tooltip>
                                            ) : undefined}
                                        </Table.Td>
                                    ) : undefined}
                                </Table.Tr>
                            );
                        })}
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
