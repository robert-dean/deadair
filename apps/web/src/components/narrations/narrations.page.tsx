import { useState } from 'react';
import { Badge, Button, Card, Group, Select, Stack, Text } from '@mantine/core';
import type { StationPiece } from '@deadair/sdk';
import { Trans, useTranslation } from 'react-i18next';

import { useNarrationPieces, useNarrationSeries, useRefreshNarrations, useRenderPiece } from '../../api/narration.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { formatMomentMinute } from '../shared/feed.moment';
import { notifyQueued } from '../shared/notify';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { type StatusTone } from '../shared/status';
import { StatusLamp } from '../shared/status.lamp';
import { formatCount } from '../../i18n/format.locale';
import { i18n } from '../../i18n/i18n.setup';

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
    const { t } = useTranslation('narrations');
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
                title={t('title')}
                description={
                    <Text size="sm" c="dimmed">
                        <Trans t={t} i18nKey="description" components={{ code: <code /> }} />
                    </Text>
                }
                actions={
                    <Button
                        size="xs"
                        variant="default"
                        loading={refresh.isPending}
                        onClick={() =>
                            refresh.mutate(undefined, {
                                onSuccess: () => notifyQueued(t('refresh.queued')),
                            })
                        }
                    >
                        {t('refresh.action')}
                    </Button>
                }
            />

            {series.error ? <ErrorAlert title={t('error.series')} error={series.error} fallback={t('error.seriesFallback')} /> : undefined}
            {pieces.error ? <ErrorAlert title={t('error.pieces')} error={pieces.error} /> : undefined}
            {refresh.error ? <ErrorAlert title={t('error.refresh')} error={refresh.error} /> : undefined}
            {renderPiece.error ? <ErrorAlert title={t('error.render')} error={renderPiece.error} /> : undefined}

            {pieces.isPending ? <PageSkeleton variant="rows" count={4} /> : undefined}

            {series.data && offered.length === 0 ? <EmptyState title={t('empty.series.title')}>{t('empty.series.body')}</EmptyState> : undefined}

            {offered.length > 0 ? (
                <Select
                    size="xs"
                    w={{ base: '100%', sm: 320 }}
                    label={t('filter.label')}
                    data={[{ value: EVERY_SERIES, label: t('filter.every') }, ...offered.map(one => ({ value: one.id, label: one.title }))]}
                    value={seriesId}
                    allowDeselect={false}
                    onChange={next => {
                        if (next !== null) setSeriesId(next);
                    }}
                />
            ) : undefined}

            {pieces.data && offered.length > 0 && listed.length === 0 ? <EmptyState>{t('empty.pieces')}</EmptyState> : undefined}

            {listed.length > 0 ? (
                <Stack gap="xs">
                    {listed.map(piece => (
                        <Piece
                            key={piece.id}
                            piece={piece}
                            asking={renderPiece.isPending && renderPiece.variables === piece.id}
                            onRender={() =>
                                renderPiece.mutate(piece.id, {
                                    onSuccess: () => notifyQueued(t('piece.queued', { title: piece.title })),
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
 *
 * A withdrawn piece reads as withdrawn even with its audio ready: the station never picks one, so
 * "Ready to air" would promise a reading that is not coming. Having been read still comes first,
 * because that is true whatever the plugin says now.
 */
export function pieceState(piece: StationPiece, now = Date.now()): { label: string; tone: StatusTone } {
    const { state, tone } = pieceStateKey(piece, now);
    return { label: i18n.t(`narrations:state.${state}`), tone };
}

type PieceStateKey = 'read' | 'withdrawn' | 'ready' | 'reading' | 'failed' | 'unread';

/** {@link pieceState} before it is put into words, so a caller can ask which state it is without comparing copy. */
function pieceStateKey(piece: StationPiece, now = Date.now()): { state: PieceStateKey; tone: StatusTone } {
    if (piece.airedAt !== undefined) return { state: 'read', tone: 'off' };
    if (piece.withdrawnAt !== undefined) return { state: 'withdrawn', tone: 'off' };
    if (piece.rendered) return { state: 'ready', tone: 'ok' };
    if (piece.rendering) return { state: 'reading', tone: 'standby' };

    const asked = piece.renderRequestedAt === undefined ? undefined : Date.parse(piece.renderRequestedAt);
    if (asked !== undefined && now - asked < READING_FOR_MS) return { state: 'reading', tone: 'standby' };
    if (piece.renderError !== undefined) return { state: 'failed', tone: 'fault' };

    return { state: 'unread', tone: 'off' };
}

/** One piece, with what the station has done with it and a way to ask for it to be spoken. */
function Piece({ piece, asking, onRender }: { piece: StationPiece; asking: boolean; onRender: () => void }) {
    const { t } = useTranslation('narrations');
    const { state: key, tone } = pieceStateKey(piece);
    const state = { label: t(`state.${key}`), tone };
    const canRender = !piece.rendered && piece.withdrawnAt === undefined && key !== 'reading';

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
                                {t('piece.words', { count: piece.wordCount, total: formatCount(piece.wordCount) })}
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
                            {t('piece.readAt', { when: formatMomentMinute(piece.airedAt, { weekday: true }) })}
                        </Text>
                    ) : undefined}

                    {/* Why it will not be read: the station's own answer to "why did it skip chapter seven". */}
                    {piece.airedAt === undefined && piece.withdrawnAt !== undefined ? (
                        <Text size="xs" c="dimmed">
                            {t('piece.withdrawnAt', { when: formatMomentMinute(piece.withdrawnAt, { weekday: true }) })}
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
                        {t('piece.render')}
                    </Button>
                ) : undefined}
            </Group>
        </Card>
    );
}
