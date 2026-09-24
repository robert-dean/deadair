import { Anchor, Badge, Card, Group, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { TrackBinding, TrackDetail } from '@deadair/sdk';

import { catalogTrackEnrichmentOptions, catalogTrackOptions, useRateTrack } from '../../api/catalog.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { formatMomentMinute, type Moment } from '../shared/feed.moment';
import { formatBytes } from '../shared/format.bytes';
import { formatDuration } from '../shared/format.duration';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { PhoneCard } from '../shared/phone.card';
import { StatusLamp } from '../shared/status.lamp';
import type { StatusTone } from '../shared/status';
import { Artwork } from '../shared/artwork';
import { usePhone } from '../shared/use.phone';
import { CATALOG_TRACK_DEFAULTS } from './catalog.page.params';
import { EnrichmentPanel } from './enrichment.panel';
import { RatingControl } from './rating.control';
import { TrackClearMenu } from './track.clear.menu';

/** A moment, to the minute. These are all "when did this last happen" rather than dates on a calendar. */
const moment = (iso: Moment | undefined): string => formatMomentMinute(iso, { fallback: '—' });

/**
 * What one copy of a record is doing, as a tone and a word.
 *
 * The order is the order an operator has to read them in, and it is why this is a function rather
 * than a lookup: a benched copy is benched whatever its cache row says, and a copy backing off after
 * failures is a different problem from one nothing has ever tried.
 */
function bindingStatus(binding: TrackBinding, t: TFunction<'catalog'>): { tone: StatusTone; label: string; detail: string } {
    // `off` rather than `fault` for the two below, and the distinction is the one `status.ts` exists
    // for: the station stood this copy down on purpose and is not currently trying, which is not the
    // same as something going wrong right now.
    if (binding.missingAt !== undefined) {
        return {
            tone: 'off',
            label: t('track.binding.benched.label'),
            detail: t('track.binding.benched.detail', { when: moment(binding.missingAt) }),
        };
    }
    if (!binding.playable) {
        return { tone: 'off', label: t('track.binding.notOffered.label'), detail: t('track.binding.notOffered.detail') };
    }
    if (binding.lastError !== undefined && binding.byteSize === undefined) {
        return {
            tone: 'fault',
            label: t('track.binding.failing.label', { attempts: binding.attempts }),
            detail: t('track.binding.failing.detail', { error: binding.lastError, when: moment(binding.nextAttemptAt) }),
        };
    }
    // `byteSize` rather than `fetchedAt`, and the difference is a record whose bytes have been
    // evicted: the sweep clears the file columns and keeps the row, so a copy that was fetched once
    // and dropped since is not on this machine however recently it arrived.
    if (binding.byteSize !== undefined) {
        return { tone: 'ok', label: t('track.binding.cached.label'), detail: t('track.binding.cached.detail', { when: moment(binding.fetchedAt) }) };
    }
    if (binding.lastServedAt !== undefined) {
        return {
            tone: 'standby',
            label: t('track.binding.dropped.label'),
            detail: t('track.binding.dropped.detail', { when: moment(binding.lastServedAt) }),
        };
    }
    // Waiting rather than broken: the station fetches a record a few boundaries before its slot, so
    // a copy nothing has needed yet is the ordinary state of most of the library.
    return { tone: 'standby', label: t('track.binding.uncached.label'), detail: t('track.binding.uncached.detail') };
}

/**
 * Everything one record has accumulated, in one place.
 *
 * The page exists because the answer to "why will this record not air" was a `psql` session: seven
 * axes of state are rows and the console could read two of them. The three answers it now
 * distinguishes are every copy benched, the bytes unfetchable and backed off, and nothing wrong at
 * all — the last being a record that is simply inside its repeat window, which is not a fault and
 * must not be drawn as one.
 *
 * Per BINDING throughout, never per track. Two copies of one record inside one provider are two
 * files with different loudness and different cue points, and the one that airs is the one that was
 * resolved.
 */
export function TrackDetailPage({ trackId }: { trackId: string }) {
    const { t } = useTranslation('catalog');
    const track = useQuery(catalogTrackOptions(trackId));
    const enrichment = useQuery(catalogTrackEnrichmentOptions(trackId));
    const rate = useRateTrack();
    const phone = usePhone();

    if (track.isPending) return <PageSkeleton variant="table" />;

    if (track.error || !track.data) {
        return <ErrorAlert title={t('track.loadFailedTitle')} error={track.error} fallback={t('track.loadFailedFallback')} />;
    }

    const detail = track.data;

    return (
        <Stack gap="lg">
            {/* Wraps on a phone rather than holding its intrinsic width: at 500px a 160px artwork
                beside the title block left no room for the title, which is why the artwork also
                shrinks. */}
            <Group align="flex-start" gap="md" wrap={phone ? 'wrap' : 'nowrap'}>
                <Artwork src={detail.albumImageUrl} alt={detail.title} size={phone ? 96 : 160} />
                <Stack gap="xxs">
                    {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                        router's own types, and with them the check that `params` matches the path. */}
                    <Anchor renderRoot={(props: object) => <Link to="/catalog/tracks" search={CATALOG_TRACK_DEFAULTS} {...props} />} size="sm">
                        {t('track.back')}
                    </Anchor>
                    <PageHeader
                        title={detail.title}
                        // On the header rather than beside each card: a clear is one gesture with
                        // four objects, and putting a button on every panel would read as four
                        // unrelated features.
                        actions={<TrackClearMenu trackId={trackId} />}
                        description={
                            <Text c="dimmed" size="sm">
                                {detail.artists}
                                {detail.albumName === undefined ? '' : ` • ${detail.albumName}`}
                                {/* This is `deadair.tracks.year`, the raw tag off the ingested file — not the
                                    enrichment panel's "Providers say released" below, which is a different fact
                                    and can disagree with this one. Worth a tooltip because this is also the
                                    year the station's own period filter reads. */}
                                {detail.year === undefined ? undefined : (
                                    <>
                                        {' • '}
                                        <Tooltip label={t('track.yearTooltip')}>
                                            <span>{detail.year}</span>
                                        </Tooltip>
                                    </>
                                )}
                                {detail.durationMs === undefined ? '' : ` • ${formatDuration(detail.durationMs)}`}
                            </Text>
                        }
                    >
                        <Group gap="xs" pt="xxs">
                            <RatingControl
                                size="xs"
                                rating={detail.rating}
                                label={detail.title}
                                busy={rate.isPending}
                                onChange={rating => {
                                    rate.mutate({ id: trackId, rating });
                                }}
                            />
                        </Group>
                    </PageHeader>
                </Stack>
            </Group>

            <BindingsCard detail={detail} phone={phone} />
            <MeasurementCard detail={detail} />
            <AiringsCard detail={detail} />

            <EnrichmentPanel
                merged={enrichment.data?.merged}
                sources={enrichment.data?.sources}
                claims={enrichment.data?.claims}
                isPending={enrichment.isPending}
                error={enrichment.error}
                emptyMessage={t('track.enrichmentEmpty')}
            />
        </Stack>
    );
}

/** Which providers hold a copy, and what the station has of each. The answer to "why will this not play". */
function BindingsCard({ detail, phone }: { detail: TrackDetail; phone: boolean }) {
    const { t } = useTranslation('catalog');
    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Eyebrow>{t('track.bindings.eyebrow')}</Eyebrow>
                    <Title order={2} size="h5">
                        {t('track.bindings.title')}
                    </Title>
                </Stack>

                {detail.bindings.length === 0 ? (
                    <EmptyState>{t('track.bindings.empty')}</EmptyState>
                ) : phone ? (
                    // A `Table.ScrollContainer` at `minWidth={600}` inside a 500px-wide page left
                    // Held and Last played from permanently off-screen with nothing telling the
                    // reader they exist, so a phone gets one card per binding instead of a sideways
                    // scroll. Same five facts as the table: plugin id, external id, state, format,
                    // held bytes and last played from.
                    <Stack gap="xxs">
                        {detail.bindings.map(binding => {
                            const status = bindingStatus(binding, t);
                            return (
                                <PhoneCard
                                    key={binding.sourceId}
                                    leading={
                                        <Stack gap={2}>
                                            <Text size="sm" fw={500}>
                                                {binding.pluginId}
                                            </Text>
                                            {binding.origin === 'discovered' ? (
                                                <Tooltip label={t('track.found.tooltip')}>
                                                    <Badge size="xs" variant="light" color="grape">
                                                        {t('track.found.badge')}
                                                    </Badge>
                                                </Tooltip>
                                            ) : undefined}
                                        </Stack>
                                    }
                                    title={
                                        <Text size="sm" c="dimmed" truncate>
                                            {binding.externalId}
                                        </Text>
                                    }
                                    subtitle={
                                        <Text size="xs" c="dimmed">
                                            {binding.bitrate === undefined
                                                ? (binding.format ?? '—')
                                                : t('track.bindings.formatBitrate', {
                                                      format: binding.format ?? '—',
                                                      kbps: Math.round(binding.bitrate / 1000),
                                                  })}
                                        </Text>
                                    }
                                    figure={
                                        <Tooltip label={status.detail} multiline w={280}>
                                            <span>
                                                <StatusLamp tone={status.tone} label={status.label} />
                                            </span>
                                        </Tooltip>
                                    }
                                    below={
                                        <Group justify="space-between" pt="xxs">
                                            <Text size="xs" c="dimmed" className="da-num">
                                                {t('track.bindings.held', { size: formatBytes(binding.byteSize) })}
                                            </Text>
                                            <Text size="xs" c="dimmed" className="da-num">
                                                {t('track.bindings.lastPlayed', { when: moment(binding.lastServedAt) })}
                                            </Text>
                                        </Group>
                                    }
                                />
                            );
                        })}
                    </Stack>
                ) : (
                    <Table.ScrollContainer minWidth={600}>
                        <Table verticalSpacing="xs" horizontalSpacing="sm">
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('track.bindings.columns.provider')}</Table.Th>
                                    <Table.Th>{t('columns.state')}</Table.Th>
                                    <Table.Th>{t('track.bindings.columns.format')}</Table.Th>
                                    <Table.Th ta="right">{t('track.bindings.columns.held')}</Table.Th>
                                    <Table.Th ta="right">{t('track.bindings.columns.lastPlayed')}</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {detail.bindings.map(binding => {
                                    const status = bindingStatus(binding, t);
                                    return (
                                        <Table.Tr key={binding.sourceId}>
                                            <Table.Td>
                                                <Stack gap="xxxs">
                                                    <Group gap="xxs">
                                                        <Text size="sm">{binding.pluginId}</Text>
                                                        {/* A discovered copy is in no playlist, which is why the
                                                        sync's sweep may not judge it. Worth saying on a page
                                                        about why a record behaves as it does. */}
                                                        {binding.origin === 'discovered' ? (
                                                            <Tooltip label={t('track.found.tooltip')}>
                                                                <Badge size="xs" variant="light" color="grape">
                                                                    {t('track.found.badge')}
                                                                </Badge>
                                                            </Tooltip>
                                                        ) : undefined}
                                                    </Group>
                                                    <Text size="xs" c="dimmed">
                                                        {binding.externalId}
                                                    </Text>
                                                </Stack>
                                            </Table.Td>
                                            <Table.Td>
                                                <Tooltip label={status.detail} multiline w={280}>
                                                    <span>
                                                        <StatusLamp tone={status.tone} label={status.label} />
                                                    </span>
                                                </Tooltip>
                                            </Table.Td>
                                            <Table.Td>
                                                <Text size="sm" c="dimmed">
                                                    {binding.bitrate === undefined
                                                        ? (binding.format ?? '—')
                                                        : t('track.bindings.formatBitrate', {
                                                              format: binding.format ?? '—',
                                                              kbps: Math.round(binding.bitrate / 1000),
                                                          })}
                                                </Text>
                                            </Table.Td>
                                            <Table.Td ta="right" className="da-num">
                                                {formatBytes(binding.byteSize)}
                                            </Table.Td>
                                            <Table.Td ta="right" className="da-num">
                                                {moment(binding.lastServedAt)}
                                            </Table.Td>
                                        </Table.Tr>
                                    );
                                })}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                )}
            </Stack>
        </Card>
    );
}

/**
 * What the sidecar made of the record.
 *
 * `complete` and `analyzedAt` are shown separately, because a measurement of a truncated download is
 * confident and wrong: a date alone would report a record as measured that no reader will use the
 * measurement of.
 */
function MeasurementCard({ detail }: { detail: TrackDetail }) {
    const { t } = useTranslation('catalog');
    const analysis = detail.analysis;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Eyebrow>{t('track.measurement.eyebrow')}</Eyebrow>
                    <Title order={2} size="h5">
                        {t('track.measurement.title')}
                    </Title>
                </Stack>

                {analysis === undefined ? (
                    <EmptyState>{t('track.measurement.empty')}</EmptyState>
                ) : (
                    <Group gap="xl" wrap="wrap">
                        <Figure label={t('columns.state')}>
                            {/* `complete` decides the tone rather than `analyzedAt`, because a
                                measurement of a truncated download carries a date and is wrong. */}
                            <StatusLamp
                                tone={analysis.failedAt !== undefined ? 'fault' : analysis.complete ? 'ok' : 'off'}
                                label={
                                    analysis.failedAt !== undefined
                                        ? t('track.measurement.failed')
                                        : analysis.complete
                                          ? t('track.measurement.measured')
                                          : t('track.measurement.incomplete')
                                }
                            />
                        </Figure>
                        {/* "Last measured" rather than "Measured", which is what the lamp beside it
                            already says — one word meaning both a state and a date is how a page
                            starts being read wrong. */}
                        <Figure label={t('track.measurement.lastMeasured')}>{moment(analysis.analyzedAt)}</Figure>
                        <Figure label={t('track.measurement.by')}>{analysis.analyzer ?? analysis.analyzerPluginId ?? '—'}</Figure>
                        <Figure label={t('track.measurement.schema')}>{analysis.schemaVersion}</Figure>
                        {analysis.failureReason === undefined ? undefined : (
                            <Figure label={t('track.measurement.whyFailed')}>{analysis.failureReason}</Figure>
                        )}
                    </Group>
                )}
            </Stack>
        </Card>
    );
}

/** When this record has been on. The head of it, with the true total, since the feed is the log. */
function AiringsCard({ detail }: { detail: TrackDetail }) {
    const { t } = useTranslation('catalog');
    return (
        <Card padding="lg">
            <Stack gap="md">
                <Group justify="space-between" align="flex-end">
                    <Stack gap="xxs">
                        <Eyebrow>{t('track.airings.eyebrow')}</Eyebrow>
                        <Title order={2} size="h5">
                            {t('track.airings.title')}
                        </Title>
                    </Stack>
                    <Text size="sm" c="dimmed" className="da-num">
                        {t('track.airings.total', { plays: detail.playCount })}
                    </Text>
                </Group>

                {detail.plays.length === 0 ? (
                    <EmptyState>{t('track.airings.empty')}</EmptyState>
                ) : (
                    <Stack gap="xxs">
                        {detail.plays.map(play => (
                            <Group key={`${play.airedAt.toISO()}-${play.source}`} justify="space-between">
                                <Text size="sm" className="da-num">
                                    {moment(play.airedAt)}
                                </Text>
                                <Text size="xs" c="dimmed">
                                    {play.source}
                                </Text>
                            </Group>
                        ))}
                    </Stack>
                )}
            </Stack>
        </Card>
    );
}

/**
 * One labelled fact.
 *
 * `component="div"` because several of these hold a `StatusLamp`, which is a group with a dot in
 * it: a paragraph containing a div is invalid HTML and React says so at runtime rather than
 * quietly.
 */
function Figure({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Stack gap="xxxs">
            <Eyebrow>{label}</Eyebrow>
            <Text component="div" size="sm">
                {children}
            </Text>
        </Stack>
    );
}
