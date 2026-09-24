import { useState } from 'react';
import { Button, Card, Group, ScrollArea, Select, Stack, Switch, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { PluginDetail, PluginLogLevel } from '@deadair/sdk';

import { sdk } from '../../api/client';
import { pluginLogsOptions, useSetPluginLogLevel } from '../../api/plugins.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { downloadFilename, saveDownload } from '../shared/download';
import { ErrorAlert } from '../shared/error.alert';
import { formatMomentFull, formatMomentStamp } from '../shared/feed.moment';
import { PageSkeleton } from '../shared/page.skeleton';

/** A Mantine palette name per level, so a scan of the tail reads severity at a glance. */
const LOG_LEVEL_COLOR: Record<PluginLogLevel, string> = {
    debug: 'gray',
    info: 'blue',
    warn: 'yellow',
    error: 'red',
};

const LEVEL_FILTER_VALUES: PluginLogLevel[] = ['debug', 'info', 'warn', 'error'];

export interface PluginLogsCardProps {
    plugin: PluginDetail;
}

/**
 * A plugin's buffered log: a filterable tail, the persisted verbose switch, and a full download.
 *
 * The `Select` and the `Switch` are not the same control. The `Select` only changes what this tail
 * shows; the `Switch` changes what the server writes to the file going forward, which is why it
 * reads from `plugin.logLevel` rather than local state — it has to survive a remount the same way
 * the rest of the plugin's settings do.
 */
export function PluginLogsCard({ plugin }: PluginLogsCardProps) {
    const { t } = useTranslation('plugins');
    const [filterLevel, setFilterLevel] = useState<PluginLogLevel | undefined>(undefined);
    const logs = useQuery(pluginLogsOptions(plugin.id, filterLevel ? { level: filterLevel } : undefined));
    const setLevel = useSetPluginLogLevel(plugin.id);
    const [downloading, setDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState<string | undefined>(undefined);

    async function download(): Promise<void> {
        setDownloading(true);
        setDownloadError(undefined);
        try {
            const { data, headers } = await sdk.plugins.downloadPluginLogs(plugin.id);
            saveDownload(data, downloadFilename(headers.contentDisposition, `${plugin.id}.log`), 'text/plain');
        } catch (error) {
            setDownloadError(apiErrorMessage(error, t('logs.downloadFailedMessage')));
        } finally {
            setDownloading(false);
        }
    }

    const entries = logs.data?.entries ?? [];

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                    <Stack gap="xxs">
                        <Title order={3} size="h5">
                            {t('logs.title')}
                        </Title>
                        <Text size="sm" c="dimmed">
                            {t('logs.description')}
                        </Text>
                    </Stack>
                    <Switch
                        checked={plugin.logLevel === 'debug'}
                        disabled={setLevel.isPending}
                        label={t('logs.verbose')}
                        aria-label={t('logs.verboseAriaLabel', { name: plugin.name })}
                        onChange={event => {
                            setLevel.mutate(event.currentTarget.checked ? 'debug' : 'info');
                        }}
                    />
                </Group>

                <Group justify="space-between" align="flex-end" wrap="wrap">
                    <Select
                        label={t('logs.filter.label')}
                        description={t('logs.filter.description')}
                        placeholder={t('logs.filter.placeholder')}
                        clearable
                        data={LEVEL_FILTER_VALUES.map(value => ({ value, label: t(`logs.level.${value}`) }))}
                        value={filterLevel ?? null}
                        onChange={value => {
                            setFilterLevel((value as PluginLogLevel | null) ?? undefined);
                        }}
                        w={{ base: '100%', sm: 180 }}
                    />
                    <Group gap="sm">
                        <Button
                            variant="default"
                            size="compact-sm"
                            loading={logs.isFetching}
                            onClick={() => {
                                void logs.refetch();
                            }}
                        >
                            {t('logs.refresh')}
                        </Button>
                        <Button variant="default" size="compact-sm" loading={downloading} onClick={() => void download()}>
                            {t('logs.download')}
                        </Button>
                    </Group>
                </Group>

                {setLevel.error ? (
                    <ErrorAlert title={t('logs.levelFailedTitle')} error={setLevel.error} fallback={t('logs.levelFailedFallback')} />
                ) : undefined}

                {downloadError ? <ErrorAlert title={t('logs.downloadFailedTitle')}>{downloadError}</ErrorAlert> : undefined}

                {logs.error ? <ErrorAlert title={t('logs.loadFailedTitle')} error={logs.error} fallback={t('logs.loadFailedFallback')} /> : undefined}

                <ScrollArea h={260} type="auto" bg="dark.8" style={{ borderRadius: 'var(--mantine-radius-sm)' }} p="xs">
                    {logs.isPending ? (
                        <PageSkeleton variant="rows" />
                    ) : entries.length === 0 ? (
                        <Text size="sm" c="dimmed" p="xs">
                            {t('logs.empty')}
                        </Text>
                    ) : (
                        <Stack gap="xxxs">
                            {entries.map((entry, index) => (
                                <Text
                                    key={`${entry.ts}-${index}`}
                                    size="xs"
                                    ff="monospace"
                                    c={LOG_LEVEL_COLOR[entry.level]}
                                    style={{ overflowWrap: 'anywhere' }}
                                >
                                    <Text component="span" c="dimmed" inherit title={formatMomentFull(entry.ts)}>
                                        {formatMomentStamp(entry.ts)}
                                    </Text>{' '}
                                    [{entry.level}] {entry.text}
                                </Text>
                            ))}
                        </Stack>
                    )}
                </ScrollArea>
            </Stack>
        </Card>
    );
}
