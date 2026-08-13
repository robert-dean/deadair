import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, SegmentedControl, Skeleton, Stack, Text, Title, Tooltip } from '@mantine/core';
import type { ActivityEntry, ActivityModule, ActivitySeverity } from '@deadair/sdk';

import { useActivity } from '../../api/activity.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { dayOf, formatMoment, formatMomentFull } from './activity.moment';

/** The filter chips, and the order an operator meets them: what airs first, what makes it after. */
const MODULES: { value: ActivityModule | 'all'; label: string }[] = [
    { value: 'all', label: 'Everything' },
    { value: 'playout', label: 'Playout' },
    { value: 'director', label: 'Programming' },
    { value: 'render', label: 'Breaks' },
    { value: 'catalog', label: 'Catalog' },
    { value: 'plugins', label: 'Plugins' },
];

const SEVERITIES: { value: ActivitySeverity | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'warn', label: 'Warnings' },
    { value: 'fault', label: 'Faults' },
];

/** A Mantine palette name per module, so a scan reads where a line came from without reading it. */
const MODULE_COLOR: Record<ActivityModule, string> = {
    playout: 'blue',
    director: 'grape',
    render: 'teal',
    catalog: 'gray',
    plugins: 'gray',
};

/**
 * What the station has been doing.
 *
 * Three sources behind one list: the station's own moments, a break's journey from planned to
 * ready, and the records that actually aired. The API unions them; this only draws them.
 *
 * **`info` is not a colour.** A station idling for want of a listener writes an `info` line and so
 * does a record airing, because a station waiting on purpose is not a fault — the same argument the
 * `ready` badge on the transport strip exists on. Only `warn` and `fault` are painted, which is what
 * makes them worth looking for.
 */
export function ActivityPage() {
    const [module, setModule] = useState<ActivityModule | 'all'>('all');
    const [severity, setSeverity] = useState<ActivitySeverity | 'all'>('all');

    const feed = useActivity({ ...(module === 'all' ? {} : { module }), ...(severity === 'all' ? {} : { minSeverity: severity }) }, true);

    const entries = feed.data?.pages.flatMap(page => page.entries) ?? [];
    const failure = feed.isError ? apiErrorMessage(feed.error, 'The activity feed could not be read.') : undefined;

    return (
        <Stack gap="lg">
            <Stack gap={6}>
                <Title order={1}>Activity</Title>
                <Text size="sm" c="dimmed">
                    What the station has done, newest first: what aired, what it wrote and spoke, and every moment a gate opened or closed on it.
                </Text>
            </Stack>

            <Group gap="md" wrap="wrap">
                <SegmentedControl
                    size="xs"
                    data={MODULES}
                    value={module}
                    onChange={value => {
                        setModule(value as ActivityModule | 'all');
                    }}
                />
                <SegmentedControl
                    size="xs"
                    data={SEVERITIES}
                    value={severity}
                    onChange={value => {
                        setSeverity(value as ActivitySeverity | 'all');
                    }}
                />
            </Group>

            {failure ? (
                <Alert color="red" title="Nothing to show">
                    {failure}
                </Alert>
            ) : undefined}

            {feed.isPending ? (
                <Stack gap="xs">
                    <Skeleton height={28} radius="sm" />
                    <Skeleton height={28} radius="sm" />
                    <Skeleton height={28} radius="sm" />
                </Stack>
            ) : undefined}

            {!feed.isPending && entries.length === 0 && failure === undefined ? (
                <Card withBorder padding="lg" radius="sm">
                    <Text size="sm" c="dimmed">
                        {module === 'all' && severity === 'all'
                            ? 'Nothing yet. The station writes here as it airs records, makes breaks and changes what it is doing.'
                            : 'Nothing matches that filter.'}
                    </Text>
                </Card>
            ) : undefined}

            {entries.length > 0 ? (
                <Card withBorder padding={0} radius="sm">
                    <Stack gap={0}>
                        {entries.map((entry, index) => (
                            <ActivityLine
                                key={entry.id}
                                entry={entry}
                                first={index === 0}
                                startsDay={dayOf(entry.at) !== dayOf(entries[index - 1]?.at)}
                            />
                        ))}
                    </Stack>
                </Card>
            ) : undefined}

            {feed.hasNextPage ? (
                <Group justify="center">
                    <Button variant="default" loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
                        Load older
                    </Button>
                </Group>
            ) : undefined}
        </Stack>
    );
}

interface ActivityLineProps {
    entry: ActivityEntry;
    first: boolean;
    /** Whether this line is the first of its calendar day, which is where the date is worth saying. */
    startsDay: boolean;
}

function ActivityLine({ entry, first, startsDay }: ActivityLineProps) {
    const painted = entry.severity !== 'info';

    return (
        <Group
            gap="sm"
            wrap="nowrap"
            align="flex-start"
            px="md"
            py={8}
            style={theme => ({ borderTop: first ? undefined : `1px solid ${theme.colors.dark[4]}` })}
        >
            <Tooltip label={formatMomentFull(entry.at)} openDelay={300}>
                <Text size="xs" c="dimmed" ff="monospace" style={{ whiteSpace: 'nowrap' }}>
                    {formatMoment(entry.at)}
                </Text>
            </Tooltip>

            <Badge size="xs" variant="light" color={MODULE_COLOR[entry.module]} tt="none" style={{ flexShrink: 0 }}>
                {entry.module}
            </Badge>

            <Stack gap={2} style={{ minWidth: 0 }}>
                {startsDay && !first ? (
                    <Text size="xs" c="dimmed">
                        {formatMomentFull(entry.at)}
                    </Text>
                ) : undefined}
                <Text size="sm" c={painted ? (entry.severity === 'fault' ? 'red' : 'yellow') : undefined}>
                    {entry.detail}
                </Text>
            </Stack>
        </Group>
    );
}
