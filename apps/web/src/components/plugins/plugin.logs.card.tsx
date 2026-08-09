import { useState } from 'react';
import { Alert, Button, Card, Group, ScrollArea, Select, Stack, Switch, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { PluginDetail, PluginLogLevel } from '@deadair/sdk';

import { sdk } from '../../api/client';
import { pluginLogsOptions, useSetPluginLogLevel } from '../../api/plugins.queries';
import { apiErrorMessage } from '../../api/sdk.error';

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

/**
 * The filename to save the download under.
 *
 * `contentDisposition` comes back `undefined` whenever the response never carried the header —
 * a proxy stripped it, or the request failed before the server set it — so the id-based name is
 * what an operator gets rather than a download that silently fails to save.
 */
function downloadFilename(contentDisposition: string | undefined, fallback: string): string {
    const match = contentDisposition ? /filename="?([^";]+)"?/i.exec(contentDisposition) : null;
    return match?.[1] ?? fallback;
}

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
        let objectUrl: string | undefined;
        try {
            const { data, headers } = await sdk.plugins.downloadPluginLogs(plugin.id);
            const blob = new Blob([data], { type: 'text/plain' });
            objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = downloadFilename(headers.contentDisposition, `${plugin.id}.log`);
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        } catch (error) {
            setDownloadError(apiErrorMessage(error, 'The log could not be downloaded.'));
        } finally {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            setDownloading(false);
        }
    }

    const entries = logs.data?.entries ?? [];

    return (
        <Card withBorder padding="lg" radius="sm">
            <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                    <Stack gap={4}>
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
                        w={180}
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
                    <Alert color="red" title="Could not change the verbose logging setting">
                        {apiErrorMessage(setLevel.error, 'The plugin was left as it was.')}
                    </Alert>
                ) : undefined}

                {downloadError ? (
                    <Alert color="red" title="Download failed">
                        {downloadError}
                    </Alert>
                ) : undefined}

                {logs.error ? (
                    <Alert color="red" title="Could not load logs">
                        {apiErrorMessage(logs.error, 'The log tail could not be fetched.')}
                    </Alert>
                ) : undefined}

                <ScrollArea h={260} type="auto" bg="dark.8" style={{ borderRadius: 'var(--mantine-radius-sm)' }} p="xs">
                    {logs.isPending ? (
                        <Text size="sm" c="dimmed" p="xs">
                            Loading…
                        </Text>
                    ) : entries.length === 0 ? (
                        <Text size="sm" c="dimmed" p="xs">
                            This plugin hasn&apos;t written anything yet.
                        </Text>
                    ) : (
                        <Stack gap={2}>
                            {entries.map((entry, index) => (
                                <Text
                                    key={`${entry.ts}-${index}`}
                                    size="xs"
                                    ff="monospace"
                                    c={LOG_LEVEL_COLOR[entry.level]}
                                    style={{ overflowWrap: 'anywhere' }}
                                >
                                    <Text component="span" c="dimmed" inherit>
                                        {entry.ts}
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
