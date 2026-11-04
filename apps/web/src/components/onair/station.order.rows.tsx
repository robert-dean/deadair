import { memo, useCallback, useRef, type KeyboardEvent, type Ref } from 'react';
import { ActionIcon, Badge, Group, Table, Text, Tooltip } from '@mantine/core';
import { IconChevronsUp, IconPencil, IconPlayerTrackNext, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { Rating, ScriptRating, StationOrderItem } from '@deadair/sdk';

import { RatingControl } from '../catalog/rating.control';
import { ScriptRatingControl } from '../scripts/script.rating.control';
import { Artwork } from '../shared/artwork';
import { AuthoredBadge } from '../shared/authored.badge';
import { AlbumLink, ArtistLink, ScriptLink, TrackLink } from '../shared/catalog.links';
import { formatDuration } from '../shared/format.duration';
import { PhoneCard } from '../shared/phone.card';
import { canRewrite, canSkipTo, isSpent, opacityFor, skipReading, stateReading, writerHint } from './station.order.rules';
import classes from './station.order.table.module.css';

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
    onSkipTo?: (item: StationOrderItem) => void;
    skippingTo: boolean;
    onRewrite?: (item: StationOrderItem) => void;
    rewriting: boolean;
    onRate?: (trackId: string, rating: Rating) => void;
    writingRating: boolean;
    onRateScript?: (scriptId: string, rating: ScriptRating) => void;
    writingScriptRating: boolean;
    /** How the virtualizer's measurement finds the item this element belongs to. */
    'data-index': number;
    ref?: Ref<HTMLTableRowElement>;
}

/**
 * The row's own interactive elements, in the order arrow keys move through them.
 *
 * One entry per STOP rather than per element: the rating control holds three radios, and the
 * point of collapsing them into a single array position is that `ArrowRight`/`ArrowLeft` treat it
 * as one thing to arrive at, the same as a link or a button. `ArrowUp`/`ArrowDown` are left alone
 * for exactly this reason — they are what still cycles disliked/neutral/liked once focus is inside
 * the control, since a handler that also claimed them would have nothing left to hand the operator
 * for actually changing a rating from the keyboard.
 *
 * Read off refs to wrapper elements this component owns rather than off the rendered anchors and
 * inputs directly: `TrackLink`/`ArtistLink`/`RatingControl` are not this file's to add `ref`
 * forwarding to, and guessing their DOM shape from outside would be exactly the "guess at
 * ordering" this was written against. A stop that renders nothing focusable — an artist with no
 * `artistId`, an item nothing can be dropped from — simply contributes no element to the array.
 */
function useRowStops() {
    const titleStopRef = useRef<HTMLSpanElement>(null);
    const artistStopRef = useRef<HTMLSpanElement>(null);
    const ratingStopRef = useRef<HTMLSpanElement>(null);
    const skipToRef = useRef<HTMLButtonElement>(null);
    const playNextRef = useRef<HTMLButtonElement>(null);
    const rewriteRef = useRef<HTMLButtonElement>(null);
    const dropRef = useRef<HTMLButtonElement>(null);

    const stops = useCallback((): HTMLElement[] => {
        const found: (HTMLElement | null)[] = [
            titleStopRef.current?.querySelector<HTMLElement>('a[href]') ?? null,
            artistStopRef.current?.querySelector<HTMLElement>('a[href]') ?? null,
            ratingStopRef.current
                ? (ratingStopRef.current.querySelector<HTMLElement>('input[type="radio"]:checked') ??
                  ratingStopRef.current.querySelector<HTMLElement>('input[type="radio"]'))
                : null,
            skipToRef.current,
            playNextRef.current,
            rewriteRef.current,
            dropRef.current,
        ];
        return found.filter((element): element is HTMLElement => element !== null);
    }, []);

    return { titleStopRef, artistStopRef, ratingStopRef, skipToRef, playNextRef, rewriteRef, dropRef, stops };
}

/**
 * One desktop row of the running order.
 *
 * Memoised because the order is re-fetched every five seconds and almost nothing on it changes
 * between polls: the query's structural sharing keeps an unchanged item's identity, so an unchanged
 * row costs a comparison rather than a render of a title, three badges, two links and a rating
 * control. The busy flags are computed by the parent so that one flipping re-renders one row.
 *
 * **The row is one Tab stop, not five.** It used to be five — the title link, the artist link, the
 * rating control, and the two action icons — and a running order of thirty items was roughly a
 * hundred and fifty presses to reach the bottom. The `Tr` itself now takes the stop (when it has
 * anything to act on: {@link OrderRowProps.editable}), the two icons drop out of the Tab order
 * entirely (`tabIndex={-1}`), and `ArrowRight`/`ArrowLeft` on the row rove between everything it
 * holds instead — see {@link useRowStops}. `Enter`/`Space` on the row itself, rather than on a
 * child that already knows what those keys mean to it, opens whatever the row is.
 */
export const OrderRow = memo(function OrderRow({
    item,
    position,
    nextUp,
    editable,
    onRemove,
    removing,
    onMove,
    moving,
    onSkipTo,
    skippingTo,
    onRewrite,
    rewriting,
    onRate,
    writingRating,
    onRateScript,
    writingScriptRating,
    'data-index': dataIndex,
    ref,
}: OrderRowProps) {
    const { t } = useTranslation('onair');
    const state = stateReading(item.state);
    const skipping = skipReading(item);
    // A segment is the station's own words, and a record the catalog has never seen
    // has no row to hold an opinion — a station can air one it never ingested.
    const trackId = item.kind === 'track' ? item.trackId : undefined;

    const rowRef = useRef<HTMLTableRowElement>(null);
    const { titleStopRef, artistStopRef, ratingStopRef, skipToRef, playNextRef, rewriteRef, dropRef, stops } = useRowStops();

    // Two keys only. `ArrowUp`/`ArrowDown` are untouched — see {@link useRowStops} — and every
    // other key on the row falls through to whatever it already does (a native click on a link,
    // for instance).
    const onKeyDown = useCallback(
        (event: KeyboardEvent<HTMLTableRowElement>) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                const rowStops = stops();
                if (rowStops.length === 0) return;
                const currentIndex = rowStops.indexOf(document.activeElement as HTMLElement);
                const wanted = currentIndex + (event.key === 'ArrowRight' ? 1 : -1);
                // Clamped rather than wrapped: an operator holding the key down lands on this
                // row's last stop and stays there, rather than the press that goes one too far
                // sliding onto a different item's controls.
                const next = rowStops[Math.max(0, Math.min(wanted, rowStops.length - 1))];
                next?.focus();
                event.preventDefault();
            } else if ((event.key === 'Enter' || event.key === ' ') && event.target === rowRef.current) {
                // Only when the ROW is what has focus. A child that is itself a link, a radio or a
                // button already answers Enter/Space in its own right, and this must not race that.
                event.preventDefault();
                titleStopRef.current?.querySelector<HTMLElement>('a[href]')?.click();
            }
        },
        [stops, titleStopRef],
    );

    return (
        <Table.Tr
            ref={element => {
                rowRef.current = element;
                if (typeof ref === 'function') ref(element);
                else if (ref) ref.current = element;
            }}
            data-index={dataIndex}
            tabIndex={editable ? 0 : undefined}
            onKeyDown={editable ? onKeyDown : undefined}
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
                    {/* `display: contents`: a wrapper this component owns, purely so
                                            {@link useRowStops} has a real ref to read the rendered
                                            anchor off, without it taking a place of its own in the
                                            Group's flex layout. */}
                    <span ref={titleStopRef} style={{ display: 'contents' }}>
                        <Title item={item} id={item.kind === 'segment' ? item.segmentId : trackId} />
                    </span>
                    {/* A segment is not a record and should not have to be worked
                                            out from an empty artist column. */}
                    {item.kind === 'segment' ? (
                        <AuthoredBadge size="xs" style={{ flexShrink: 0 }}>
                            {t('order.segment')}
                        </AuthoredBadge>
                    ) : undefined}
                    {/* A talk-over never becomes something the player is handed: it
                                            is heard ALONGSIDE the record after it, with the music
                                            ducked under it. */}
                    {item.overAtMs === undefined ? undefined : (
                        <AuthoredBadge size="xs" style={{ flexShrink: 0 }}>
                            {item.overEndOf ? t('order.overEnd') : t('order.over')}
                        </AuthoredBadge>
                    )}
                    {/* A record the station chose to sound like the playlist around it, rather
                                            than one the playlist named. Grape, because that is the
                                            palette's colour for what the station authored. */}
                    {item.mixedIn ? (
                        <Tooltip label={t('order.mixedInHint')} multiline maw={320}>
                            <AuthoredBadge size="xs" style={{ flexShrink: 0 }}>
                                {t('order.mixedIn')}
                            </AuthoredBadge>
                        </Tooltip>
                    ) : undefined}
                    {/* A record the station chose to follow a listener's request, on a request
                                            show. Grape for the same reason as a mixed-in record. */}
                    {item.followsRequest ? (
                        <Tooltip label={t('order.followsRequestHint')} multiline maw={320}>
                            <AuthoredBadge size="xs" style={{ flexShrink: 0 }}>
                                {t('order.followsRequest')}
                            </AuthoredBadge>
                        </Tooltip>
                    ) : undefined}
                    {/* Which writer produced the words. Without it a model that
                                            degrades to the station's own phrasings on every single
                                            break looks exactly like a model that is working, and the
                                            answer has been on the row since it was written. */}
                    {item.segmentWriter === undefined ? undefined : (
                        <Tooltip label={writerHint(item.segmentWriter)} multiline maw={360}>
                            <AuthoredBadge size="xs" authored={item.segmentWriter === 'model'} style={{ flexShrink: 0 }}>
                                {item.segmentWriter}
                            </AuthoredBadge>
                        </Tooltip>
                    )}
                    {/* The station SKIPS a segment that has no audio when it comes
                                            round, rather than waiting for one. An operator reading the
                                            order has to be able to see which items will not be heard —
                                            and, just as importantly, which ones are simply not written
                                            yet. See `skipReading`. */}
                    {skipping ? (
                        <Tooltip multiline maw={360} label={skipping.hint}>
                            <Badge size="xs" variant="light" color={skipping.colour} style={{ flexShrink: 0 }}>
                                {skipping.label}
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
                <span ref={artistStopRef} style={{ display: 'contents' }}>
                    <ArtistLink id={item.artistId} size="sm" c={item.artistId === undefined ? 'dimmed' : undefined} truncate>
                        {item.artists.join(', ')}
                    </ArtistLink>
                </span>
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
                    {item.kind === 'segment' && item.scriptId !== undefined && onRateScript ? (
                        <span ref={ratingStopRef} style={{ display: 'contents' }}>
                            <ScriptRatingControl
                                rating={item.scriptRating}
                                busy={writingScriptRating}
                                onChange={rating => {
                                    onRateScript(item.scriptId!, rating);
                                }}
                            />
                        </span>
                    ) : trackId === undefined ? undefined : (
                        <span ref={ratingStopRef} style={{ display: 'contents' }}>
                            <RatingControl
                                size="xs"
                                rating={item.rating}
                                label={item.title}
                                busy={writingRating}
                                onChange={rating => {
                                    onRate(trackId, rating);
                                }}
                            />
                        </span>
                    )}
                </Table.Td>
            ) : undefined}
            {editable ? (
                <Table.Td>
                    <Group gap={2} wrap="nowrap">
                        {/* Unlike the move beside it, this reaches past what the player is
                                                holding and cuts what is on air, so it is the one
                                                control here a listener hears at once. */}
                        {onSkipTo && canSkipTo(item) ? (
                            <Tooltip label={t('order.skipToHint')} multiline maw={320}>
                                <ActionIcon
                                    ref={skipToRef}
                                    variant="subtle"
                                    color="gray"
                                    aria-label={t('order.skipTo', { title: item.title })}
                                    tabIndex={-1}
                                    loading={skippingTo}
                                    onClick={() => onSkipTo(item)}
                                >
                                    <IconPlayerTrackNext size={15} stroke={1.8} />
                                </ActionIcon>
                            </Tooltip>
                        ) : undefined}
                        {/* Not on the row already at the front: a control
                                                whose only effect is to leave the order exactly as
                                                it was teaches an operator that this corner of the
                                                row does nothing, which is the same argument the
                                                spent rows below are drawn bare on. */}
                        {onMove && item.state === 'planned' && position !== nextUp ? (
                            <Tooltip label={t('order.playNextHint')} multiline maw={340}>
                                <ActionIcon
                                    ref={playNextRef}
                                    variant="subtle"
                                    color="gray"
                                    aria-label={t('order.playNext', { title: item.title })}
                                    // Reachable through the row's own arrow-key roving rather than
                                    // Tab: see the note on {@link OrderRow} for why the row itself
                                    // is the stop.
                                    tabIndex={-1}
                                    loading={moving}
                                    onClick={() => onMove(item, nextUp)}
                                >
                                    <IconChevronsUp size={15} stroke={1.8} />
                                </ActionIcon>
                            </Tooltip>
                        ) : undefined}
                        {/* The one way a failed break comes back: nothing else retries
                                            it, because the usual reason it failed is that there was
                                            nothing true to say, which an edit to the phrasings or a
                                            model switched on is exactly what changes. */}
                        {onRewrite && canRewrite(item) ? (
                            <Tooltip label={t('order.rewriteHint')} multiline maw={340}>
                                <ActionIcon
                                    ref={rewriteRef}
                                    variant="subtle"
                                    color="gray"
                                    aria-label={t('order.rewrite', { title: item.title })}
                                    tabIndex={-1}
                                    loading={rewriting}
                                    onClick={() => onRewrite(item)}
                                >
                                    <IconPencil size={15} stroke={1.8} />
                                </ActionIcon>
                            </Tooltip>
                        ) : undefined}
                        {/* Nothing at all on a spent item, rather than a disabled
                                            control: the player is holding it or it is behind us, and an
                                            affordance that could only ever answer 422 is worse than no
                                            affordance. */}
                        {onRemove && !isSpent(item.state) ? (
                            <Tooltip label={t('order.dropHint')}>
                                <ActionIcon
                                    ref={dropRef}
                                    variant="subtle"
                                    color="red"
                                    aria-label={t('order.drop', { title: item.title })}
                                    tabIndex={-1}
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
 *
 * The skeleton lives in {@link PhoneCard} — this component owns only the running order's selection
 * and its two accents: the airing card's bar, and history at half weight.
 */
export const PhoneRow = memo(function PhoneRow({
    item,
    onRemove,
    removing,
    onSkipTo,
    skippingTo,
    onRewrite,
    rewriting,
}: {
    item: StationOrderItem;
    onRemove?: (item: StationOrderItem) => void;
    removing: boolean;
    onSkipTo?: (item: StationOrderItem) => void;
    skippingTo: boolean;
    onRewrite?: (item: StationOrderItem) => void;
    rewriting: boolean;
}) {
    const { t } = useTranslation('onair');
    const state = stateReading(item.state);
    const airing = item.state === 'airing';

    return (
        <PhoneCard
            leading={<Artwork src={item.artworkUrl} alt={item.title} size={36} radius="xs" />}
            title={
                <>
                    <Text size="sm" fw={airing ? 600 : 400} truncate>
                        {item.title}
                    </Text>
                    {item.kind === 'segment' ? (
                        <AuthoredBadge size="xs" style={{ flexShrink: 0 }}>
                            {t('order.segment')}
                        </AuthoredBadge>
                    ) : undefined}
                </>
            }
            subtitle={
                <>
                    <Text size="xs" c="dimmed" truncate>
                        {item.artists.join(', ')}
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
                </>
            }
            figure={
                <Text size="xs" c="dimmed" className="da-num">
                    {formatDuration(item.durationMs)}
                </Text>
            }
            // 44px each, because these are used with a thumb and one of them is destructive. Nothing
            // at all where neither applies, rather than a disabled affordance that could only ever
            // answer 422.
            action={
                onRemove || onSkipTo || onRewrite ? (
                    <Group gap={0} wrap="nowrap">
                        {onSkipTo ? (
                            <ActionIcon
                                variant="subtle"
                                color="gray"
                                w={44}
                                h={44}
                                aria-label={t('order.skipTo', { title: item.title })}
                                loading={skippingTo}
                                onClick={() => onSkipTo(item)}
                            >
                                <IconPlayerTrackNext size={16} stroke={1.8} />
                            </ActionIcon>
                        ) : undefined}
                        {onRewrite ? (
                            <ActionIcon
                                variant="subtle"
                                color="gray"
                                w={44}
                                h={44}
                                aria-label={t('order.rewrite', { title: item.title })}
                                loading={rewriting}
                                onClick={() => onRewrite(item)}
                            >
                                <IconPencil size={16} stroke={1.8} />
                            </ActionIcon>
                        ) : undefined}
                        {onRemove ? (
                            <ActionIcon
                                variant="subtle"
                                color="red"
                                w={44}
                                h={44}
                                aria-label={t('order.drop', { title: item.title })}
                                loading={removing}
                                onClick={() => onRemove(item)}
                            >
                                <IconX size={16} stroke={1.8} />
                            </ActionIcon>
                        ) : undefined}
                    </Group>
                ) : undefined
            }
            accent={airing ? 'var(--mantine-color-red-6)' : undefined}
            opacity={opacityFor(item)}
        />
    );
});
