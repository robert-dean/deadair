import { useState } from 'react';
import { Button, Card, Group, ScrollArea, Select, Stack, Text } from '@mantine/core';
import type { LogLevel, LogSource } from '@deadair/sdk';

import { sdk } from '../../api/client';
import { useLog, useLogSources } from '../../api/station.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { downloadFilename, saveDownload } from '../shared/download';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { formatBytes } from '../shared/format.bytes';
import { formatMomentFull, formatMomentStamp } from '../shared/feed.moment';
import { PageSkeleton } from '../shared/page.skeleton';

/**
 * A Mantine palette name per level, so a scan of the tail reads severity at a glance.
 *
 * Five, where `PluginLogsCard`'s copy has four: `api.log` is written by `DeadairLogger`, which tees
 * every level the app-wide logger has. `trace` is dimmer than `debug` because it is noisier still.
 */
const LOG_LEVEL_COLOR: Record<LogLevel, string> = {
    trace: 'dark.2',
    debug: 'gray',
    info: 'blue',
    warn: 'yellow',
    error: 'red',
};

const LEVEL_FILTER_DATA: { value: LogLevel; label: string }[] = [
    { value: 'trace', label: 'Trace' },
    { value: 'debug', label: 'Debug' },
    { value: 'info', label: 'Info' },
    { value: 'warn', label: 'Warn' },
    { value: 'error', label: 'Error' },
];

/**
 * Every log this install writes to disk, read without a shell on the box.
 *
 * ## Why a picker rather than a card each
 *
 * The plugin log is a card on the plugin's own page, because it belongs to the thing that page is
 * about. These three belong to the install, and an operator arrives here already knowing which one
 * they want — so one viewer and a source `Select` beats three cards competing for the same screen,
 * and the height a log needs to be readable is a height only one of them can have.
 *
 * ## A source that is not there is still offered
 *
 * Absent is a state rather than a fault: a station whose stream has never run has no Liquidsoap log,
 * and the dev tree cannot see those files at all. Hiding an absent source would answer the operator's
 * question ("where is the audio chain's log?") by pretending they had not asked it, so it stays in
 * the list, says so, and the panel explains what would fill it.
 *
 * ## Only one source can be filtered
 *
 * `levels` comes off the source rather than being assumed. The station's own lines carry a level
 * this app wrote and can grade; Liquidsoap's and the shim's do not, and a level control over those
 * would be a control that appeared to work. It is not rendered for them at all.
 */
export function LogsPage() {
    const sources = useLogSources();
    const [chosenId, setChosenId] = useState<string | undefined>(undefined);
    const [level, setLevel] = useState<LogLevel | undefined>(undefined);
    const [downloading, setDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState<string | undefined>(undefined);

    const available = sources.data?.sources ?? [];
    // The first source, until an operator picks one. The API answers in a fixed order with the
    // station's own log at the head, which is the one somebody opening this page came for. Not
    // memoized: `available` is a fresh array every render, so a `useMemo` over it would recompute
    // every time anyway while looking as though it did not.
    const source: LogSource | undefined = available.find(entry => entry.id === chosenId) ?? available[0];

    // Asking for a level the chosen source cannot apply would put a filter on screen that does
    // nothing, so it is dropped at the point of asking rather than left to the server to ignore.
    const appliedLevel = source?.levels === true ? level : undefined;
    const log = useLog(source?.id, appliedLevel);

    async function download(): Promise<void> {
        if (source === undefined) return;

        setDownloading(true);
        setDownloadError(undefined);
        try {
            const { data, headers } = await sdk.station.downloadLog(source.id);
            saveDownload(data, downloadFilename(headers.contentDisposition, `deadair-${source.id}.log`), 'text/plain');
        } catch (error) {
            setDownloadError(apiErrorMessage(error, 'The log could not be downloaded.'));
        } finally {
            setDownloading(false);
        }
    }

    if (sources.isPending) return <PageSkeleton variant="rows" />;
    if (sources.error) return <ErrorAlert title="Could not load the logs" error={sources.error} fallback="The list of logs could not be fetched." />;
    if (source === undefined) {
        return <EmptyState title="No logs">This install writes nothing to disk that this console knows how to read.</EmptyState>;
    }

    const lines = log.data?.lines ?? [];

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Group justify="space-between" align="flex-end" wrap="wrap">
                    <Select
                        label="Log"
                        description={source.description}
                        data={available.map(entry => ({
                            value: entry.id,
                            label: entry.present ? `${entry.label} (${formatBytes(entry.bytes)})` : `${entry.label} — nothing written yet`,
                        }))}
                        value={source.id}
                        onChange={value => {
                            if (value === null) return;
                            setChosenId(value);
                        }}
                        allowDeselect={false}
                        w={{ base: '100%', sm: 320 }}
                    />
                    <Group gap="sm" align="flex-end">
                        {source.levels ? (
                            <Select
                                label="Show"
                                description="Filters this tail. Changes nothing on disk."
                                placeholder="All levels"
                                clearable
                                data={LEVEL_FILTER_DATA}
                                value={level ?? null}
                                onChange={value => {
                                    setLevel((value as LogLevel | null) ?? undefined);
                                }}
                                w={{ base: '100%', sm: 180 }}
                            />
                        ) : undefined}
                        <Button
                            variant="default"
                            size="compact-sm"
                            loading={log.isFetching}
                            disabled={!source.present}
                            onClick={() => {
                                void log.refetch();
                            }}
                        >
                            Refresh
                        </Button>
                        <Button variant="default" size="compact-sm" loading={downloading} disabled={!source.present} onClick={() => void download()}>
                            Download
                        </Button>
                    </Group>
                </Group>

                <Group gap="xs">
                    {source.lastWriteAt ? (
                        <Text size="xs" c="dimmed" title={formatMomentFull(source.lastWriteAt)}>
                            Last written {formatMomentStamp(source.lastWriteAt)}
                        </Text>
                    ) : undefined}
                    {log.data?.truncated ? (
                        // The two stream logs are rotated by nothing, so the read is bounded by
                        // bytes. An operator must not read the oldest line here as the file's first.
                        <Text size="xs" c="dimmed">
                            Showing the end of a longer file. Older lines are on disk but not here.
                        </Text>
                    ) : undefined}
                </Group>

                {downloadError ? <ErrorAlert title="Download failed">{downloadError}</ErrorAlert> : undefined}

                {log.error ? <ErrorAlert title="Could not load the log" error={log.error} fallback="The tail could not be fetched." /> : undefined}

                <ScrollArea h={480} type="auto" bg="dark.8" style={{ borderRadius: 'var(--mantine-radius-sm)' }} p="xs">
                    {log.isPending ? (
                        <PageSkeleton variant="rows" />
                    ) : lines.length === 0 ? (
                        <Text size="sm" c="dimmed" p="xs">
                            {source.present ? 'Nothing here at this level.' : `Nothing has been written to this log. ${absentBecause(source.id)}`}
                        </Text>
                    ) : (
                        <Stack gap="xxxs">
                            {lines.map((line, index) => (
                                <Text
                                    key={`${line.ts ?? index}-${index}`}
                                    size="xs"
                                    ff="monospace"
                                    c={line.level ? LOG_LEVEL_COLOR[line.level] : undefined}
                                    style={{ overflowWrap: 'anywhere' }}
                                >
                                    {line.ts ? (
                                        <>
                                            <Text component="span" c="dimmed" inherit title={formatMomentFull(line.ts)}>
                                                {formatMomentStamp(line.ts)}
                                            </Text>{' '}
                                        </>
                                    ) : undefined}
                                    {line.level ? `[${line.level}] ` : ''}
                                    {line.text}
                                </Text>
                            ))}
                        </Stack>
                    )}
                </ScrollArea>
            </Stack>
        </Card>
    );
}

/**
 * What would fill an empty log, per source.
 *
 * An empty state that says what would fill it, on `EmptyState`'s own rule, applied to a panel that
 * is not one. The two stream answers are different: one process has never run, the other only exists
 * on an install that fetches its records that way.
 */
function absentBecause(id: string): string {
    if (id === 'liquidsoap') return 'The audio chain writes it once it starts, and it is not visible to the console outside the station container.';
    if (id === 'shim') return 'The track shim writes it, and only an install that fetches records through one has it at all.';

    return 'The station writes it from its first line, so an empty one means this process has only just started.';
}
