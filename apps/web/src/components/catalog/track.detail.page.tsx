import { Anchor, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { catalogTrackEnrichmentOptions, catalogTrackOptions, useRateTrack, useSuspend } from '../../api/catalog.queries';
import { ErrorAlert } from '../shared/error.alert';
import { formatDuration } from '../shared/format.duration';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { QueryView } from '../shared/query.view';
import { Artwork } from '../shared/artwork';
import { usePhone } from '../shared/use.phone';
import { CATALOG_TRACK_DEFAULTS } from './catalog.page.params';
import { EnrichmentPanel } from './enrichment.panel';
import { RatingControl } from './rating.control';
import { TrackClearMenu } from './track.clear.menu';
import { LyricsCard } from './lyrics.card';
import { VocalMarkersCard } from './vocal.markers.card';
import { SuspendControl } from './suspend.control';
import { AiringsCard, BindingsCard, MeasurementCard } from './track.record.cards';

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
    const suspend = useSuspend();
    const phone = usePhone();

    return (
        <Stack gap="lg">
            <QueryView
                query={track}
                skeleton={<PageSkeleton variant="table" />}
                errorTitle={t('track.loadFailedTitle')}
                errorFallback={t('track.loadFailedFallback')}
            >
                {detail => (
                    <>
                        {rate.error ? <ErrorAlert title={t('writes.rateFailed')} error={rate.error} /> : undefined}
                        {suspend.error ? <ErrorAlert title={t('suspend.failed')} error={suspend.error} /> : undefined}
                        {/* Wraps on a phone rather than holding its intrinsic width: at 500px a 160px artwork
                            beside the title block left no room for the title, which is why the artwork also
                            shrinks. */}
                        <Group align="flex-start" gap="md" wrap={phone ? 'wrap' : 'nowrap'}>
                            <Artwork src={detail.albumImageUrl} alt={detail.title} size={phone ? 96 : 160} />
                            <Stack gap="xxs">
                                {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                                    router's own types, and with them the check that `params` matches the path. */}
                                <Anchor
                                    renderRoot={(props: object) => <Link to="/catalog/tracks" search={CATALOG_TRACK_DEFAULTS} {...props} />}
                                    size="sm"
                                >
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
                                        <SuspendControl
                                            {...(detail.suspendedUntil === undefined ? {} : { suspendedUntil: detail.suspendedUntil })}
                                            busy={suspend.isPending}
                                            onSuspend={days => suspend.mutate({ kind: 'track', id: trackId, days })}
                                            onLift={() => suspend.mutate({ kind: 'track', id: trackId, days: undefined })}
                                        />
                                    </Group>
                                </PageHeader>
                            </Stack>
                        </Group>

                        <BindingsCard detail={detail} phone={phone} />
                        <MeasurementCard detail={detail} />
                        <VocalMarkersCard trackId={trackId} />
                        <LyricsCard trackId={trackId} />
                        <AiringsCard detail={detail} />

                        <EnrichmentPanel
                            merged={enrichment.data?.merged}
                            sources={enrichment.data?.sources}
                            claims={enrichment.data?.claims}
                            isPending={enrichment.isPending}
                            error={enrichment.error}
                            emptyMessage={t('track.enrichmentEmpty')}
                        />
                    </>
                )}
            </QueryView>
        </Stack>
    );
}
