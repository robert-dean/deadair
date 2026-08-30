import { useState } from 'react';
import { Button, Card, Group, ScrollArea, Select, Stack, Switch, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
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

const LEVEL_FILTER_DATA: { value: PluginLogLevel; label: string }[] = [
    { value: 'debug', label: 'Debug' },
    { value: 'info', label: 'Info' },
    { value: 'warn', label: 'Warn' },
    { value: 'error', label: 'Error' },
];

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
            setDownloadError(apiErrorMessage(error, 'The log could not be downloaded.'));
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
                            Logs
                        </Title>
                        <Text size="sm" c="dimmed">
                            What this plugin has written recently.
                        </Text>
                    </Stack>
                    <Switch
                        checked={plugin.logLevel === 'debug'}
                        disabled={setLevel.isPending}
                        label="Verbose logging"
                        aria-label={`Verbose logging for ${plugin.name}`}
                        onChange={event => {
                            setLevel.mutate(event.currentTarget.checked ? 'debug' : 'info');
                        }}
                    />
                </Group>

                <Group justify="space-between" align="flex-end" wrap="wrap">
                    <Select
                        label="Show"
                        description="Filters this tail. Does not change what the plugin writes."
                        placeholder="All levels"
                        clearable
                        data={LEVEL_FILTER_DATA}
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
                            Refresh
                        </Button>
                        <Button variant="default" size="compact-sm" loading={downloading} onClick={() => void download()}>
                            Download
                        </Button>
                    </Group>
                </Group>

                {setLevel.error ? (
                    <ErrorAlert
                        title="Could not change the verbose logging setting"
                        error={setLevel.error}
                        fallback="The plugin was left as it was."
                    />
                ) : undefined}

                {downloadError ? <ErrorAlert title="Download failed">{downloadError}</ErrorAlert> : undefined}

                {logs.error ? <ErrorAlert title="Could not load logs" error={logs.error} fallback="The log tail could not be fetched." /> : undefined}

                <ScrollArea h={260} type="auto" bg="dark.8" style={{ borderRadius: 'var(--mantine-radius-sm)' }} p="xs">
                    {logs.isPending ? (
                        <PageSkeleton variant="rows" />
                    ) : entries.length === 0 ? (
                        <Text size="sm" c="dimmed" p="xs">
                            This plugin hasn&apos;t written anything yet.
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
