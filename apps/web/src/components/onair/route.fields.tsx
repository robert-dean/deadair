import { Button, Group, List, Stack, Text, TextInput } from '@mantine/core';
import type { GetInputPropsReturnType } from '@mantine/form';
import { useTranslation } from 'react-i18next';
import type { ArtistRoute, RouteStop } from '@deadair/sdk';

import { usePreviewRoute } from '../../api/director.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';

export interface RouteFieldsProps {
    from: GetInputPropsReturnType & { value: string };
    to: GetInputPropsReturnType & { value: string };
}

/**
 * A new show that travels from one artist to another, and a look at the way before it airs.
 *
 * Both names or neither: one end of a route is not a route. The preview is the point of the button
 * rather than a nicety, because it says how many steps rest on a record two artists share and how
 * many only on a similarity source's opinion, which is the difference between a journey a presenter
 * can talk through and a wander, and it is also what makes putting it on air quick afterwards.
 */
export function RouteFields({ from, to }: RouteFieldsProps) {
    const { t } = useTranslation('onair');
    const preview = usePreviewRoute();
    const both = from.value.trim().length > 0 && to.value.trim().length > 0;

    return (
        <Stack gap="xs">
            <Text size="sm" fw={600}>
                {t('route.label')}
            </Text>
            <Text size="xs" c="dimmed">
                {t('route.description')}
            </Text>
            <Group grow align="flex-start">
                <TextInput label={t('route.from')} placeholder={t('route.fromPlaceholder')} {...from} />
                <TextInput label={t('route.to')} placeholder={t('route.toPlaceholder')} {...to} />
            </Group>
            <Group justify="flex-end">
                <Button
                    variant="light"
                    size="compact-sm"
                    disabled={!both}
                    loading={preview.isPending}
                    onClick={() => preview.mutate({ from: from.value.trim(), to: to.value.trim() })}
                >
                    {t('route.preview')}
                </Button>
            </Group>
            {preview.isError ? <ErrorAlert>{apiErrorMessage(preview.error, t('route.previewFailed'))}</ErrorAlert> : undefined}
            {preview.data ? <RoutePreview route={preview.data} /> : undefined}
        </Stack>
    );
}

function RoutePreview({ route }: { route: ArtistRoute }) {
    const { t } = useTranslation('onair');
    if (!route.found) {
        return (
            <Text size="sm" c="orange.4">
                {t('route.none')}
            </Text>
        );
    }

    return (
        <Stack gap={4}>
            <Text size="xs" c="dimmed">
                {t('route.summary', { count: route.stops.length, factual: route.factual, similar: route.similar })}
            </Text>
            <List size="sm" type="ordered" spacing={2}>
                {route.stops.map((stop, index) => (
                    <List.Item key={`${index}-${stop.artist}`}>
                        <Text span size="sm" fw={500}>
                            {stop.artist}
                        </Text>{' '}
                        <Text span size="xs" c="dimmed">
                            {linkWords(stop, t)}
                        </Text>
                    </List.Item>
                ))}
            </List>
        </Stack>
    );
}

/** How a stop connects to the one before, in the operator's words. */
function linkWords(stop: RouteStop, t: ReturnType<typeof useTranslation<'onair'>>['t']): string {
    if (stop.link === 'credit') return t('route.viaCredit', { title: stop.sharedTitle ?? '', lead: stop.sharedLead ?? '' });
    if (stop.link === 'similar') return t('route.viaSimilar', { source: stop.sourceName ?? stop.source ?? '' });
    return t('route.start');
}
