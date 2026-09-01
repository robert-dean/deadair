import { useState } from 'react';
import { Anchor, Badge, Group, Select, Stack, Table, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { StationChart } from '@deadair/sdk';

import { useChart, useCharts } from '../../api/charts.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { PhoneCard } from '../shared/phone.card';
import { usePhone } from '../shared/use.phone';
import { CATALOG_TRACK_DEFAULTS } from '../catalog/catalog.page.params';

/**
 * What the rest of the world is playing.
 *
 * A menu rather than a merge, exactly as the contract behind it is: these routes enumerate and never
 * combine, and this page schedules nothing. A chart entry is not a record the station owns — it is
 * strings, deliberately, because everything that would turn one into a record it can air (the
 * ingest, the dislike veto, the repeat window, the artist spacing, the fetch-and-bench) already sits
 * downstream of a name. So the one thing each row offers is a way to go and LOOK, which is the
 * catalog search this console already has.
 *
 * The page is inert on purpose and that is a stage rather than an omission: `chart-discovery.md`
 * puts the generator that plays from a chart last, on the argument that a surface which changes what
 * airs should come after one that proves the fetch, the rate budget and the config field work.
 */
export function ChartsPage() {
    const charts = useCharts();
    const phone = usePhone();
    const [chosen, setChosen] = useState<string | undefined>(undefined);

    const offered = charts.data?.charts ?? [];
    // Whatever the operator picked, or the first one there is. Falling back rather than making them
    // choose before the page shows anything: with one chart installed a picker is a formality.
    const showing = offered.find(chart => chart.id === chosen) ?? offered.at(0);
    const chart = useChart(showing?.id);

    return (
        <Stack gap="lg">
            <PageHeader
                title="Charts"
                description={
                    <Text size="sm" c="dimmed">
                        What the rest of the world is playing, as the installed plugins report it. Nothing here is scheduled: a chart is something to
                        look at, and the station plays what its own programming chooses.
                    </Text>
                }
            />

            {charts.error ? (
                <ErrorAlert title="The charts could not be read" error={charts.error} fallback="No plugin answered with a chart." />
            ) : undefined}

            {charts.isPending ? <PageSkeleton variant="table" /> : undefined}

            {charts.data && offered.length === 0 ? (
                <EmptyState title="No plugin offers a chart">
                    A chart arrives with a plugin that publishes one. Enable one that declares the <code>charts</code> capability and its charts
                    appear here.
                </EmptyState>
            ) : undefined}

            {showing === undefined ? undefined : (
                <>
                    <Group gap="md" align="flex-end" wrap="wrap">
                        <Select
                            size="xs"
                            w={{ base: '100%', sm: 320 }}
                            label="Chart"
                            data={offered.map(one => ({ value: one.id, label: labelFor(one) }))}
                            value={showing.id}
                            allowDeselect={false}
                            onChange={next => {
                                if (next !== null) setChosen(next);
                            }}
                        />
                        {/* Which plugin answered, because a station with two chart plugins offering
                            similar names has no other way to tell them apart. */}
                        <Badge size="sm" variant="light" color="gray" tt="none" mb={6}>
                            {showing.pluginId}
                        </Badge>
                        {showing.description === undefined ? undefined : (
                            <Text size="xs" c="dimmed" maw={520} pb={6}>
                                {showing.description}
                            </Text>
                        )}
                    </Group>

                    {chart.error ? (
                        <ErrorAlert title="That chart could not be read" error={chart.error} fallback="The plugin did not answer." />
                    ) : undefined}

                    {chart.isPending ? <PageSkeleton variant="table" /> : undefined}

                    {/* An empty chart is a 200 rather than an error, on the contract's own rule: a
                        chart is something to look at and never something the station needs to air,
                        so a source that had nothing today is an ordinary answer. */}
                    {chart.data && chart.data.records.length === 0 ? (
                        <EmptyState title="Nothing in this edition">
                            The plugin answered with no records. That is an ordinary state for a chart that has not published yet today.
                        </EmptyState>
                    ) : undefined}

                    {/* The phone gets cards rather than a table that scrolls sideways. The rank
                        leads because it is what a chart IS; peak and weeks ride the second line as
                        a fact rather than holding two columns; the album is the dropped one. Chosen
                        with the media query rather than `hiddenFrom`, so a hundred entries are not
                        rendered twice. */}
                    {phone && chart.data && chart.data.records.length > 0 ? (
                        <Stack gap="xxs">
                            {chart.data.records.map(record => (
                                <PhoneCard
                                    key={`${record.rank}-${record.title}-${record.artist}`}
                                    leading={
                                        <Text size="sm" className="da-num" w={28} ta="right">
                                            {record.rank}
                                        </Text>
                                    }
                                    title={
                                        <>
                                            <Text size="sm" truncate>
                                                {record.title}
                                            </Text>
                                            {record.featuring === undefined || record.featuring.length === 0 ? undefined : (
                                                <Text size="xs" c="dimmed" truncate>
                                                    feat. {record.featuring.join(', ')}
                                                </Text>
                                            )}
                                        </>
                                    }
                                    subtitle={
                                        <>
                                            <Text size="xs" c="dimmed" truncate>
                                                {record.artist}
                                            </Text>
                                            {record.peak !== undefined || record.weeksOn !== undefined ? (
                                                <Text size="xs" c="dimmed" className="da-num" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                                                    {[
                                                        record.peak !== undefined ? `peak ${record.peak}` : undefined,
                                                        record.weeksOn !== undefined ? `${record.weeksOn} wks` : undefined,
                                                    ]
                                                        .filter(part => part !== undefined)
                                                        .join(' · ')}
                                                </Text>
                                            ) : undefined}
                                        </>
                                    }
                                    action={
                                        <Anchor
                                            renderRoot={(props: object) => (
                                                <Link to="/catalog/tracks" search={{ ...CATALOG_TRACK_DEFAULTS, search: record.title }} {...props} />
                                            )}
                                            size="xs"
                                        >
                                            Find in catalog
                                        </Anchor>
                                    }
                                />
                            ))}
                        </Stack>
                    ) : undefined}

                    {!phone && chart.data && chart.data.records.length > 0 ? (
                        <Table.ScrollContainer minWidth={700}>
                            <Table highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th w={60}>#</Table.Th>
                                        <Table.Th>Title</Table.Th>
                                        <Table.Th>Artist</Table.Th>
                                        <Table.Th visibleFrom="lg">Album</Table.Th>
                                        <Table.Th w={80}>Peak</Table.Th>
                                        <Table.Th w={90}>Weeks</Table.Th>
                                        <Table.Th w={130} />
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {chart.data.records.map(record => (
                                        <Table.Tr key={`${record.rank}-${record.title}-${record.artist}`}>
                                            {/* Every figure here counts or ranks, so all of them are
                                            tabular: a column of proportional digits in a ranked
                                            table reads as ragged. */}
                                            <Table.Td className="da-num">{record.rank}</Table.Td>
                                            <Table.Td>
                                                <Text size="sm">{record.title}</Text>
                                                {/* The lead artist is what the row is filed under, so the
                                                other credits ride here rather than being joined into
                                                one name the catalog would never match. */}
                                                {record.featuring === undefined || record.featuring.length === 0 ? undefined : (
                                                    <Text size="xs" c="dimmed">
                                                        feat. {record.featuring.join(', ')}
                                                    </Text>
                                                )}
                                            </Table.Td>
                                            <Table.Td>
                                                <Text size="sm">{record.artist}</Text>
                                                {record.year === undefined ? undefined : (
                                                    <Text size="xs" c="dimmed" className="da-num">
                                                        {record.year}
                                                    </Text>
                                                )}
                                            </Table.Td>
                                            <Table.Td visibleFrom="lg">
                                                <Text size="sm" c="dimmed">
                                                    {record.album ?? '—'}
                                                </Text>
                                            </Table.Td>
                                            <Table.Td className="da-num">{record.peak ?? '—'}</Table.Td>
                                            <Table.Td className="da-num">{record.weeksOn ?? '—'}</Table.Td>
                                            <Table.Td>
                                                {/* A search rather than a claim about ownership. The
                                                contract carries no catalog id and should not: this
                                                asks the question rather than pretending to know. */}
                                                <Anchor
                                                    renderRoot={(props: object) => (
                                                        <Link
                                                            to="/catalog/tracks"
                                                            search={{ ...CATALOG_TRACK_DEFAULTS, search: record.title }}
                                                            {...props}
                                                        />
                                                    )}
                                                    size="xs"
                                                >
                                                    Find in catalog
                                                </Anchor>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </Table.ScrollContainer>
                    ) : undefined}
                </>
            )}
        </Stack>
    );
}

/** A chart's name, plus what distinguishes it from the others the same plugin offers. */
function labelFor(chart: StationChart): string {
    const qualifiers = [chart.country, chart.genre].filter(one => one !== undefined);
    return qualifiers.length === 0 ? chart.name : `${chart.name} (${qualifiers.join(', ')})`;
}
