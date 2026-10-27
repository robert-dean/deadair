import { useState } from 'react';
import { Anchor, Badge, Button, Card, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { Trans, useTranslation } from 'react-i18next';
import type { Recording } from '@deadair/sdk';

import { BASE_URL } from '../../api/client';
import { useDeleteRecording, useRecordings } from '../../api/archive.queries';
import { apiErrorMessage, isForbidden } from '../../api/sdk.error';
import { useArmedPress } from '../desk/armed.press';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { formatBytes } from '../shared/format.bytes';
import { formatDuration } from '../shared/format.duration';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { StatusLamp } from '../shared/status.lamp';
import { toneColor } from '../shared/status';
import { formatClock, perLocale } from '../../i18n/format.locale';

const DAY = perLocale(locale => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }));

/** A recording's audio, from the API, with the signed token it was listed with. */
const audioSrc = (recording: Recording): string => `${BASE_URL}${recording.audioUrl}`;

/** The same, as a download: the whole file, named after the show. */
const downloadHref = (recording: Recording): string => `${audioSrc(recording)}${recording.audioUrl.includes('?') ? '&' : '?'}download=true`;

/**
 * What the station kept of what it aired, to listen back to or cut clips from.
 *
 * Grouped by the day a recording began, newest first, because that is how somebody looks for one:
 * "Saturday's show". Playing one opens a player under its row rather than at the top of the page,
 * so the thing playing stays beside the name it was found by, and only one plays at a time.
 */
export function RecordingsPage() {
    const { t } = useTranslation('station');
    const archive = useRecordings();
    const [playing, setPlaying] = useState<string | undefined>(undefined);

    const settingsLink = (
        <Button variant="default" size="xs" renderRoot={(props: object) => <Link to="/settings/stream" {...props} />}>
            {t('recordings.settings')}
        </Button>
    );

    return (
        <Stack gap="lg">
            <PageHeader
                title={t('recordings.title')}
                description={
                    <Text size="sm" c="dimmed">
                        {t('recordings.description')}
                    </Text>
                }
                actions={settingsLink}
            >
                {archive.data ? (
                    <Group gap="sm">
                        <StatusLamp
                            tone={archive.data.mode === 'off' ? 'off' : 'live'}
                            label={t(`recordings.mode.${archive.data.mode}`)}
                            emphasis="chip"
                        />
                        <Text size="xs" c="dimmed">
                            {archive.data.retentionDays === 0
                                ? t('recordings.keptForever')
                                : t('recordings.kept', { count: archive.data.retentionDays })}
                        </Text>
                    </Group>
                ) : undefined}
            </PageHeader>

            {archive.isError ? <ErrorAlert error={archive.error} fallback={t('recordings.failure')} /> : undefined}
            {archive.isPending ? <PageSkeleton variant="rows" count={4} /> : undefined}

            {archive.data && archive.data.recordings.length === 0 ? (
                <EmptyState>
                    {archive.data.mode === 'off' ? (
                        <Trans
                            t={t}
                            i18nKey="recordings.empty.off"
                            components={{ settings: <Anchor renderRoot={(props: object) => <Link to="/settings/stream" {...props} />} /> }}
                        />
                    ) : (
                        t(`recordings.empty.${archive.data.mode}`)
                    )}
                </EmptyState>
            ) : undefined}

            {archive.data
                ? byDay(archive.data.recordings).map(([day, recordings]) => (
                      <Stack key={day} gap="xs">
                          <Eyebrow>{day}</Eyebrow>
                          <Card padding={0}>
                              {recordings.map(recording => (
                                  <RecordingRow
                                      key={recording.id}
                                      recording={recording}
                                      playing={playing === recording.id}
                                      onPlay={() => setPlaying(current => (current === recording.id ? undefined : recording.id))}
                                  />
                              ))}
                          </Card>
                      </Stack>
                  ))
                : undefined}
        </Stack>
    );
}

/** The recordings under the day each began, in the order they came. */
function byDay(recordings: readonly Recording[]): [string, Recording[]][] {
    const days = new Map<string, Recording[]>();
    for (const recording of recordings) {
        const day = DAY().format(recording.startedAt.toJSDate());
        days.set(day, [...(days.get(day) ?? []), recording]);
    }
    return [...days.entries()];
}

/** One recording: what it is, when it ran, how big it is, and what can be done with it. */
function RecordingRow({ recording, playing, onPlay }: { recording: Recording; playing: boolean; onPlay: () => void }) {
    const { t } = useTranslation('station');
    const remove = useDeleteRecording();
    const deletePress = useArmedPress(() => remove.mutate(recording.id));

    const started = formatClock(recording.startedAt.toJSDate());
    const ended = recording.endedAt === undefined ? undefined : formatClock(recording.endedAt.toJSDate());
    const failure = remove.isError
        ? isForbidden(remove.error)
            ? t('recordings.deleteForbidden')
            : apiErrorMessage(remove.error, t('recordings.deleteFailed'))
        : undefined;

    return (
        <Stack gap="xs" px="md" py="sm" style={{ borderBottom: '1px solid var(--da-border)' }}>
            <Group gap="sm" wrap="nowrap" align="center">
                <Text size="sm" c="dimmed" className="da-num" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {ended === undefined ? started : `${started}–${ended}`}
                </Text>

                <Badge size="xs" variant="light" color={recording.kind === 'live' ? toneColor.live : 'gray'} tt="none" style={{ flexShrink: 0 }}>
                    {t(`recordings.kind.${recording.kind}`)}
                </Badge>

                <Text size="sm" truncate style={{ minWidth: 0, flex: 1 }}>
                    {recording.title ?? t(`recordings.untitled.${recording.kind}`)}
                </Text>

                {recording.recording ? (
                    <StatusLamp tone="live" label={t('recordings.recordingNow')} pulse />
                ) : (
                    <Text size="xs" c="dimmed" className="da-num" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {recording.endedAt === undefined ? undefined : formatDuration(recording.endedAt.toMillis() - recording.startedAt.toMillis())}
                    </Text>
                )}

                <Text size="xs" c="dimmed" className="da-num" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {formatBytes(recording.bytes)}
                </Text>
            </Group>

            <Group gap="xs">
                <Button size="compact-xs" variant={playing ? 'filled' : 'default'} onClick={onPlay}>
                    {t('recordings.play')}
                </Button>
                <Button size="compact-xs" variant="default" component="a" href={downloadHref(recording)} download>
                    {t('recordings.download')}
                </Button>
                {recording.recording ? undefined : (
                    <Tooltip label={deletePress.armed ? t('recordings.deleteArmedHint') : t('recordings.deleteHint')} multiline maw={280}>
                        <Button
                            size="compact-xs"
                            color="red"
                            variant={deletePress.armed ? 'filled' : 'subtle'}
                            loading={remove.isPending}
                            onClick={deletePress.press}
                        >
                            {deletePress.armed ? t('recordings.confirmDelete') : t('recordings.delete')}
                        </Button>
                    </Tooltip>
                )}
            </Group>

            {failure === undefined ? undefined : (
                <Text size="xs" c="red">
                    {failure}
                </Text>
            )}

            {playing ? (
                // A browser asks for an MP3 a range at a time, so seeking an hour in fetches only
                // what is played from there. `preload="metadata"` so opening the player is not a
                // download of the whole file.
                <audio controls autoPlay preload="metadata" src={audioSrc(recording)} style={{ width: '100%' }} />
            ) : undefined}
        </Stack>
    );
}
