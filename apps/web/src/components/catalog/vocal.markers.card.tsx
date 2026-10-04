import { useState } from 'react';
import { Button, Card, Checkbox, Group, NumberInput, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { VocalMarkersDetail } from '@deadair/sdk';

import { catalogTrackVocalMarkersOptions, useVocalMarkers } from '../../api/catalog.queries';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { StatusLamp } from '../shared/status.lamp';

/** Milliseconds as seconds to a tenth, which is the precision a person setting a post by ear has. */
const seconds = (ms: number | undefined): string => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`);

/**
 * Where the singing starts and stops on a record, and a way to correct it.
 *
 * The station talks a record up to the post, the first sung word, and the post comes from the
 * record's timed lyrics, which are typed by volunteers and sometimes land early. An operator who has
 * listened knows better, so the correction is right here and wins until it is cleared. Never a word
 * of the lyric: what this shows is two times and where they came from.
 */
export function VocalMarkersCard({ trackId }: { trackId: string }) {
    const { t } = useTranslation('catalog');
    const markers = useQuery(catalogTrackVocalMarkersOptions(trackId));
    const [editing, setEditing] = useState(false);

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Group justify="space-between" align="flex-end">
                    <Stack gap="xxs">
                        <Eyebrow>{t('track.vocal.eyebrow')}</Eyebrow>
                        <Title order={2} size="h5">
                            {t('track.vocal.title')}
                        </Title>
                    </Stack>
                    {markers.data && !editing ? (
                        <Button size="xs" variant="default" onClick={() => setEditing(true)}>
                            {t('track.vocal.correct')}
                        </Button>
                    ) : undefined}
                </Group>

                {markers.error ? <ErrorAlert title={t('track.vocal.loadFailed')} error={markers.error} /> : undefined}
                {markers.data && !editing ? <VocalMarkersFigures detail={markers.data} trackId={trackId} /> : undefined}
                {markers.data && editing ? <VocalMarkersForm detail={markers.data} trackId={trackId} onDone={() => setEditing(false)} /> : undefined}
            </Stack>
        </Card>
    );
}

function VocalMarkersFigures({ detail, trackId }: { detail: VocalMarkersDetail; trackId: string }) {
    const { t } = useTranslation('catalog');
    const { clear } = useVocalMarkers(trackId);

    if (detail.kind === 'unknown') return <Text size="sm">{t('track.vocal.unknown')}</Text>;

    return (
        <Stack gap="xs">
            <Group gap="xl" wrap="wrap">
                <Stack gap="xxxs">
                    <Eyebrow>{t('track.vocal.post')}</Eyebrow>
                    <Text size="sm" className="da-num">
                        {detail.kind === 'instrumental' ? t('track.vocal.instrumental') : seconds(detail.onsetMs)}
                    </Text>
                </Stack>
                {detail.kind === 'ranges' ? (
                    <Stack gap="xxxs">
                        <Eyebrow>{t('track.vocal.end')}</Eyebrow>
                        <Text size="sm" className="da-num">
                            {seconds(detail.endMs)}
                        </Text>
                    </Stack>
                ) : undefined}
                <Stack gap="xxxs">
                    <Eyebrow>{t('track.vocal.from')}</Eyebrow>
                    <StatusLamp tone={detail.source === 'override' ? 'ok' : 'standby'} label={t(`track.vocal.source.${detail.source}`)} />
                </Stack>
            </Group>
            {detail.source === 'override' ? (
                <Group>
                    <Button size="xs" variant="subtle" loading={clear.isPending} onClick={() => clear.mutate()}>
                        {t('track.vocal.useLyrics')}
                    </Button>
                </Group>
            ) : undefined}
            {clear.error ? <ErrorAlert title={t('track.vocal.saveFailed')} error={clear.error} /> : undefined}
        </Stack>
    );
}

function VocalMarkersForm({ detail, trackId, onDone }: { detail: VocalMarkersDetail; trackId: string; onDone: () => void }) {
    const { t } = useTranslation('catalog');
    const { set } = useVocalMarkers(trackId);
    const [instrumental, setInstrumental] = useState(detail.kind === 'instrumental');
    const [onset, setOnset] = useState<number | string>(detail.onsetMs === undefined ? '' : detail.onsetMs / 1000);
    const [end, setEnd] = useState<number | string>(detail.endMs === undefined ? '' : detail.endMs / 1000);

    const toMs = (value: number | string): number | undefined =>
        typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) : undefined;
    const onsetMs = toMs(onset);
    const endMs = toMs(end);
    const ready = instrumental || onsetMs !== undefined;

    return (
        <Stack gap="sm">
            <Checkbox
                label={t('track.vocal.instrumentalLabel')}
                checked={instrumental}
                onChange={event => setInstrumental(event.currentTarget.checked)}
            />
            {instrumental ? undefined : (
                <Group gap="md" wrap="wrap" align="flex-start">
                    <NumberInput
                        label={t('track.vocal.post')}
                        description={t('track.vocal.postHelp')}
                        suffix=" s"
                        decimalScale={1}
                        min={0}
                        value={onset}
                        onChange={setOnset}
                        w={180}
                    />
                    <NumberInput
                        label={t('track.vocal.end')}
                        description={t('track.vocal.endHelp')}
                        suffix=" s"
                        decimalScale={1}
                        min={0}
                        value={end}
                        onChange={setEnd}
                        w={180}
                    />
                </Group>
            )}
            {set.error ? <ErrorAlert title={t('track.vocal.saveFailed')} error={set.error} /> : undefined}
            <Group gap="xs">
                <Button
                    size="xs"
                    disabled={!ready}
                    loading={set.isPending}
                    onClick={() =>
                        set.mutate(instrumental ? { instrumental: true } : { onsetMs, ...(endMs === undefined ? {} : { endMs }) }, {
                            onSuccess: onDone,
                        })
                    }
                >
                    {t('track.vocal.save')}
                </Button>
                <Button size="xs" variant="default" onClick={onDone}>
                    {t('track.vocal.cancel')}
                </Button>
            </Group>
        </Stack>
    );
}
