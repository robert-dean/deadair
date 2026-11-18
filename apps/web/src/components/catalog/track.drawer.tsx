import { useState } from 'react';
import { Alert, Button, Drawer, Group, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { catalogTrackOptions, useRateTrack } from '../../api/catalog.queries';
import { useCreateRequest } from '../../api/requests.queries';
import { outcomeOf } from '../../party/party.rules';
import { Artwork } from '../shared/artwork';
import { ErrorAlert } from '../shared/error.alert';
import { formatDuration } from '../shared/format.duration';
import { notifyQueued } from '../shared/notify';
import { PageSkeleton } from '../shared/page.skeleton';
import { QueryView } from '../shared/query.view';
import { usePhone } from '../shared/use.phone';
import { RatingControl } from './rating.control';
import { AiringsCard, BindingsCard, MeasurementCard } from './track.record.cards';

/**
 * One record, opened from the tracks list without leaving it.
 *
 * The list is where an operator goes through a library, and the record's own page took them away
 * from the page and the filter they were working through. This is the part of that page a glance
 * needs: the copies, the measurement and the airings, read from the same query the page reads, so
 * the two cannot disagree. Everything slower (lyrics, markers, enrichment, clearing) stays on the
 * full page, one link away.
 *
 * Request goes through the listener door rather than the running order, for the reason
 * `RequestARecord` gives: it is held to the station's rules and lands in the Requests list with
 * everybody else's. A refusal stays in the drawer, because the operator is still looking at it.
 */
export function TrackDrawer({ id, onClose }: { id: string | undefined; onClose: () => void }) {
    const { t } = useTranslation('catalog');
    const phone = usePhone();
    const track = useQuery({ ...catalogTrackOptions(id ?? ''), enabled: id !== undefined });
    const rate = useRateTrack();
    const request = useCreateRequest();
    const [refused, setRefused] = useState<{ id: string; reason?: string } | undefined>();

    const close = () => {
        setRefused(undefined);
        request.reset();
        onClose();
    };

    const ask = (trackId: string) =>
        request.mutate(
            { trackId },
            {
                onSuccess: answer => {
                    const outcome = outcomeOf(answer);
                    if (outcome.kind === 'refused') {
                        setRefused({ id: trackId, ...(outcome.reason === undefined ? {} : { reason: outcome.reason }) });
                        return;
                    }
                    setRefused(undefined);
                    notifyQueued(
                        outcome.kind === 'waiting'
                            ? t('drawer.request.waiting', { title: outcome.title })
                            : t('drawer.request.onItsWay', { title: outcome.title }),
                    );
                },
            },
        );

    return (
        <Drawer
            opened={id !== undefined}
            onClose={close}
            position="right"
            size={phone ? '100%' : 'xl'}
            title={
                track.data === undefined ? (
                    t('drawer.title')
                ) : (
                    <Text fw={600} lineClamp={2}>
                        {track.data.title}
                    </Text>
                )
            }
        >
            {id === undefined ? undefined : (
                <QueryView
                    query={track}
                    skeleton={<PageSkeleton variant="rows" count={6} />}
                    errorTitle={t('track.loadFailedTitle')}
                    errorFallback={t('track.loadFailedFallback')}
                >
                    {detail => (
                        <Stack gap="md">
                            {rate.error ? <ErrorAlert title={t('writes.rateFailed')} error={rate.error} /> : undefined}
                            <Group align="flex-start" gap="md" wrap="nowrap">
                                <Artwork src={detail.albumImageUrl} alt={detail.albumName ?? detail.title} size={96} />
                                <Stack gap="xxs" miw={0}>
                                    <Text size="sm">{detail.artists}</Text>
                                    <Text size="sm" c="dimmed">
                                        {[
                                            detail.albumName,
                                            detail.year,
                                            detail.durationMs === undefined ? undefined : formatDuration(detail.durationMs),
                                        ]
                                            .filter(part => part !== undefined)
                                            .join(' • ')}
                                    </Text>
                                    <RatingControl
                                        size="xs"
                                        rating={detail.rating}
                                        label={detail.title}
                                        busy={rate.isPending}
                                        onChange={rating => {
                                            rate.mutate({ id: detail.id, rating });
                                        }}
                                    />
                                </Stack>
                            </Group>

                            <Group gap="xs">
                                <Button size="xs" loading={request.isPending} onClick={() => ask(detail.id)}>
                                    {t('drawer.request.action')}
                                </Button>
                                {/* `renderRoot` rather than `component={Link}`, and `: object` on it, so the
                                    router still checks the route and its params. */}
                                <Button
                                    size="xs"
                                    variant="default"
                                    renderRoot={(props: object) => <Link to="/catalog/tracks/$trackId" params={{ trackId: detail.id }} {...props} />}
                                >
                                    {t('drawer.openPage')}
                                </Button>
                            </Group>
                            {refused?.id === detail.id ? (
                                <Alert color="red" title={t('drawer.request.refused')}>
                                    {refused.reason ?? t('drawer.request.refusedPlain')}
                                </Alert>
                            ) : undefined}
                            {request.isError ? (
                                <ErrorAlert title={t('drawer.request.failed')} error={request.error} fallback={t('drawer.request.failedFallback')} />
                            ) : undefined}

                            <BindingsCard detail={detail} phone={phone} />
                            <MeasurementCard detail={detail} />
                            <AiringsCard detail={detail} />
                        </Stack>
                    )}
                </QueryView>
            )}
        </Drawer>
    );
}
