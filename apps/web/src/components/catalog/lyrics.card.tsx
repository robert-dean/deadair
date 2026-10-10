import { useState } from 'react';
import { Badge, Button, Card, Group, ScrollArea, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { LyricLineDetail, TrackLyrics, TrackLyricsSource } from '@deadair/sdk';

import { catalogTrackLyricsOptions, catalogTrackLyricsSourcesOptions } from '../../api/catalog.queries';
import { formatLocale } from '../../i18n/format.locale';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';

/** A line's start as a clock reads it, `1:04`, on the file's own timeline. Figures rather than words, so no catalog entry. */
const clock = (ms: number): string => {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** A BCP 47 tag as the console's language names it, or the tag itself when the browser cannot. */
const languageName = (tag: string): string => {
    try {
        return new Intl.DisplayNames([formatLocale()], { type: 'language' }).of(tag) ?? tag;
    } catch {
        return tag;
    }
};

/**
 * The words of a record, as the station found them.
 *
 * Read-only: the words are a lyrics source's, not the operator's, and what an operator corrects is
 * where the singing starts, on the card above. The text is shown exactly as it arrived, which is why
 * none of it is in a catalog. The sources are a second read, made only when somebody opens them.
 */
export function LyricsCard({ trackId }: { trackId: string }) {
    const { t } = useTranslation('catalog');
    const lyrics = useQuery(catalogTrackLyricsOptions(trackId));
    const [showSources, setShowSources] = useState(false);

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Group justify="space-between" align="flex-end">
                    <Stack gap="xxs">
                        <Eyebrow>{t('track.lyrics.eyebrow')}</Eyebrow>
                        <Title order={2} size="h5">
                            {t('track.lyrics.title')}
                        </Title>
                    </Stack>
                    {lyrics.data && lyrics.data.kind !== 'none' ? (
                        <Button size="xs" variant="subtle" onClick={() => setShowSources(open => !open)}>
                            {showSources ? t('track.lyrics.hideSources') : t('track.lyrics.showSources')}
                        </Button>
                    ) : undefined}
                </Group>

                {lyrics.error ? <ErrorAlert title={t('track.lyrics.loadFailed')} error={lyrics.error} /> : undefined}
                {lyrics.data ? <LyricsBody lyrics={lyrics.data} /> : undefined}
                {showSources ? <LyricsSources trackId={trackId} /> : undefined}
            </Stack>
        </Card>
    );
}

function LyricsBody({ lyrics }: { lyrics: TrackLyrics }) {
    const { t } = useTranslation('catalog');
    const provider = lyrics.provider ?? '';

    if (lyrics.kind === 'none') return <Text size="sm">{t('track.lyrics.none')}</Text>;
    if (lyrics.kind === 'instrumental') return <Text size="sm">{t('track.lyrics.instrumental', { provider })}</Text>;

    return (
        <Stack gap="xs">
            <ScrollArea h={320} type="auto">
                {lyrics.synced ? <TimedLines lines={lyrics.synced} /> : <PlainWords text={lyrics.plain ?? ''} />}
            </ScrollArea>
            <Group gap="xs">
                <Badge variant="light" color={lyrics.synced ? 'teal' : 'gray'}>
                    {lyrics.synced ? t('track.lyrics.timed') : t('track.lyrics.untimed')}
                </Badge>
                <Text size="xs" c="dimmed">
                    {lyrics.language
                        ? t('track.lyrics.fromIn', { provider, language: languageName(lyrics.language) })
                        : t('track.lyrics.from', { provider })}
                </Text>
            </Group>
        </Stack>
    );
}

function TimedLines({ lines }: { lines: readonly LyricLineDetail[] }) {
    return (
        <Stack gap={2}>
            {lines.map((line, index) => (
                <Group key={`${line.atMs}-${index}`} gap="md" wrap="nowrap" align="baseline">
                    <Text size="xs" c="dimmed" className="da-num" w={44} ta="right">
                        {clock(line.atMs)}
                    </Text>
                    {/* An empty line is the gap a source marks between verses: kept as space, not as a blank row of text. */}
                    <Text size="sm">{line.text === '' ? ' ' : line.text}</Text>
                </Group>
            ))}
        </Stack>
    );
}

function PlainWords({ text }: { text: string }) {
    return (
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {text}
        </Text>
    );
}

function LyricsSources({ trackId }: { trackId: string }) {
    const { t } = useTranslation('catalog');
    const sources = useQuery(catalogTrackLyricsSourcesOptions(trackId));

    if (sources.error) return <ErrorAlert title={t('track.lyrics.sourcesFailed')} error={sources.error} />;
    if (!sources.data) return undefined;

    return (
        <Stack gap="xs">
            {sources.data.sources.map(source => (
                <Group key={source.provider} justify="space-between" wrap="nowrap">
                    <Text size="sm">{source.provider}</Text>
                    <Group gap="sm" wrap="nowrap">
                        <Text size="xs" c="dimmed">
                            {t('track.lyrics.source.fetched', { when: fetched(source) })}
                        </Text>
                        <Badge variant="outline" color="gray">
                            {t(`track.lyrics.source.${kindOf(source)}`)}
                        </Badge>
                    </Group>
                </Group>
            ))}
        </Stack>
    );
}

const kindOf = (source: TrackLyricsSource): 'synced' | 'plain' | 'instrumental' =>
    source.synced ? 'synced' : source.instrumental ? 'instrumental' : 'plain';

const fetched = (source: TrackLyricsSource): string => source.fetchedAt.toLocaleString(DateTime.DATE_MED, { locale: formatLocale() });
