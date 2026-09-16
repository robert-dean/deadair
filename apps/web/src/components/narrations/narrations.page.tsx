import { useState } from 'react';
import { Badge, Button, Card, Group, Select, Stack, Text } from '@mantine/core';
import type { StationPiece } from '@deadair/sdk';

import { useNarrationPieces, useNarrationSeries, useRefreshNarrations, useRenderPiece } from '../../api/narration.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { formatMomentMinute } from '../shared/feed.moment';
import { notifyQueued } from '../shared/notify';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { type StatusTone } from '../shared/status';
import { StatusLamp } from '../shared/status.lamp';

/** The series filter at rest. */
const EVERY_SERIES = 'all';

/**
 * How long after asking the station counts a reading as still being made.
 *
 * The station's own window before it would ask again (`RENDER_RETRY_AFTER_MS`, an hour), so the page
 * says "Reading" for exactly as long as the station would refuse to start a second one. Far longer
 * than a podcast's fetch, because this is several takes on the one speech engine rather than a
 * download, and each of them yields to anything the presenter needs.
 */
const READING_FOR_MS = 60 * 60_000;

/**
 * What the station reads out in its own voice: the series a plugin offers, the pieces of each it
 * knows about, and what it has done with them.
 *
 * A piece airs when a `narration` band on the format clock names its series, and this page is where
 * an operator sees whether that will work: whether the next chapter has been spoken yet, whether it
 * failed and why, and where the station has got to in a book. A reading can be asked for here ahead
 * of the clock, which is also how one that failed is tried again.
 *
 * The series come from the plugins, which may open and parse whatever each one lives in, so they are
 * the slow half of the page; the pieces are the station's own table and answer at once.
 */
export function NarrationsPage() {
    const series = useNarrationSeries();
    const [seriesId, setSeriesId] = useState<string>(EVERY_SERIES);
    const pieces = useNarrationPieces(seriesId === EVERY_SERIES ? undefined : seriesId);
    const refresh = useRefreshNarrations();
    const renderPiece = useRenderPiece();

    const offered = series.data?.series ?? [];
    const listed = pieces.data?.pieces ?? [];

    return (
        <Stack gap="lg">
            <PageHeader
                title="Readings"
                description={
                    <Text size="sm" c="dimmed">
                        Books, columns and anything else the station reads out in its presenter&apos;s voice. A <code>narration</code> band on the
                        format clock reads the next piece at its time: the next chapter of a book, or the newest issue of a column. The station speaks
                        it a few hours beforehand.
                    </Text>
                }
                actions={
                    <Button
                        size="xs"
                        variant="default"
                        loading={refresh.isPending}
                        onClick={() =>
                            refresh.mutate(undefined, {
                                onSuccess: () => notifyQueued('The station is reading every series again. New pieces appear here in a minute or two.'),
                            })
                        }
                    >
                        Look for new pieces
                    </Button>
                }
            />

            {series.error ? <ErrorAlert title="The series could not be read" error={series.error} fallback="No narration plugin answered." /> : undefined}
            {pieces.error ? <ErrorAlert title="The pieces could not be read" error={pieces.error} /> : undefined}
            {refresh.error ? <ErrorAlert title="The series could not be read again" error={refresh.error} /> : undefined}
            {renderPiece.error ? <ErrorAlert title="That piece could not be asked for" error={renderPiece.error} /> : undefined}

            {pieces.isPending ? <PageSkeleton variant="rows" count={4} /> : undefined}

            {series.data && offered.length === 0 ? (
                <EmptyState title="The station has nothing to read yet">
                    Install a narration plugin and point it at a book or a feed on its own settings page. What it offers arrives here once the station
                    has looked.
                </EmptyState>
            ) : undefined}

            {offered.length > 0 ? (
                <Select
                    size="xs"
                    w={{ base: '100%', sm: 320 }}
                    label="Series"
                    data={[{ value: EVERY_SERIES, label: 'Every series' }, ...offered.map(one => ({ value: one.id, label: one.title }))]}
                    value={seriesId}
                    allowDeselect={false}
                    onChange={next => {
                        if (next !== null) setSeriesId(next);
                    }}
                />
            ) : undefined}

            {pieces.data && offered.length > 0 && listed.length === 0 ? (
                <EmptyState>
                    The station has found no pieces yet. It looks twice an hour; look now to see what there is.
                </EmptyState>
            ) : undefined}

            {listed.length > 0 ? (
                <Stack gap="xs">
                    {listed.map(piece => (
                        <Piece
                            key={piece.id}
                            piece={piece}
                            asking={renderPiece.isPending && renderPiece.variables === piece.id}
                            onRender={() =>
                                renderPiece.mutate(piece.id, {
                                    onSuccess: () => notifyQueued(`Reading ${piece.title}. It is ready to air once the station has spoken it.`),
                                })
                            }
                        />
                    ))}
                </Stack>
            ) : undefined}
        </Stack>
    );
}

/**
 * What the station has done with a piece, in one word and the console's own tone for it.
 *
 * A reading that failed is a `fault` rather than anything red: the station is still working, and on
 * this desk red is the transmitter. Being spoken is `standby`, the tone for waiting.
 *
 * The station tells the page two different things about a reading in progress, and they are not the
 * same: `rendering` means a production actually exists and its parts are being spoken, where a recent
 * `renderRequestedAt` only means somebody asked. Both read as "Reading" to an operator, and the first
 * is the one that survives a restart.
 */
export function pieceState(piece: StationPiece, now = Date.now()): { label: string; tone: StatusTone } {
    if (piece.airedAt !== undefined) return { label: 'Read', tone: 'off' };
    if (piece.rendered) return { label: 'Ready to air', tone: 'ok' };
    if (piece.rendering) return { label: 'Reading', tone: 'standby' };

    const asked = piece.renderRequestedAt === undefined ? undefined : Date.parse(piece.renderRequestedAt);
    if (asked !== undefined && now - asked < READING_FOR_MS) return { label: 'Reading', tone: 'standby' };
    if (piece.renderError !== undefined) return { label: 'Could not read', tone: 'fault' };

    return { label: 'Not read yet', tone: 'off' };
}

/** One piece, with what the station has done with it and a way to ask for it to be spoken. */
function Piece({ piece, asking, onRender }: { piece: StationPiece; asking: boolean; onRender: () => void }) {
    const state = pieceState(piece);
    const canRender = !piece.rendered && state.label !== 'Reading';

    return (
        <Card padding="md">
            <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
                <Stack gap="xxs" style={{ minWidth: 0 }}>
                    <Group gap="xs" wrap="wrap">
                        <Badge size="xs" variant="light" color="gray" tt="none">
                            {piece.seriesTitle}
                        </Badge>
                        <StatusLamp tone={state.tone} label={state.label} />
                        {/* Where it comes in a book, which is the one thing a serial's operator actually
                            navigates by. Counted from one, where the station counts from zero. */}
                        {piece.ordinal === undefined ? undefined : (
                            <Text size="xs" c="dimmed" className="da-num">
                                #{piece.ordinal + 1}
                            </Text>
                        )}
                        {piece.publishedAt === undefined ? undefined : (
                            <Text size="xs" c="dimmed" className="da-num">
                                {formatMomentMinute(piece.publishedAt)}
                            </Text>
                        )}
                        {piece.wordCount === undefined ? undefined : (
                            <Text size="xs" c="dimmed" className="da-num">
                                {piece.wordCount.toLocaleString()} words
                            </Text>
                        )}
                    </Group>

                    <Text size="sm" fw={600}>
                        {piece.title}
                    </Text>

                    {piece.summary === undefined ? undefined : (
                        <Text size="sm" c="dimmed" lineClamp={3}>
                            {piece.summary}
                        </Text>
                    )}

                    {piece.airedAt !== undefined ? (
                        <Text size="xs" c="dimmed">
                            Read {formatMomentMinute(piece.airedAt, { weekday: true })}.
                        </Text>
                    ) : undefined}

                    {/* The reason, in full, because it is the only place an operator can learn that the
                        station has no mixer or that the source could not be opened. */}
                    {piece.airedAt === undefined && piece.renderError !== undefined ? (
                        <Text size="xs" c="dimmed">
                            {piece.renderError}
                        </Text>
                    ) : undefined}
                </Stack>

                {canRender ? (
                    <Button size="xs" variant="default" loading={asking} onClick={onRender}>
                        Read it now
                    </Button>
                ) : undefined}
            </Group>
        </Card>
    );
}
