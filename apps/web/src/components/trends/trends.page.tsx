import { useMemo, useState, type ReactNode } from 'react';
import { AreaChart, BarChart, LineChart } from '@mantine/charts';
import { Card, Group, Select, SegmentedControl, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import type { MetricSeries, MetricSeriesPage } from '@deadair/sdk';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';

import { useMetricNames, useMetricSeries } from '../../api/metrics.queries';
import { useSignedIn } from '../../auth/session.store';
import { formatCount, hourCycle, perLocale } from '../../i18n/format.locale';
import { Eyebrow } from '../shared/eyebrow';
import { formatBytes } from '../shared/format.bytes';
import { formatSpent } from '../shared/format.spent';
import { PageHeader } from '../shared/page.header';
import { binSeries, meanOf, named, rank, total, TREND_METRICS, TREND_RANGES, type Bin, type TrendRange } from './trends.data';

/** The two series colours, each theme's own validated pair (see `--da-series-a` in `tokens.css`). */
const SERIES_A = 'var(--da-series-a)';
const SERIES_B = 'var(--da-series-b)';
/** A reference line that is context rather than a series: the library's total, behind what is measured. */
const REFERENCE = 'var(--da-text-dimmed)';

const CHART_HEIGHT = 220;
const RANKED_ROWS = 8;

const TIME = perLocale(locale => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', ...hourCycle() }));
const WEEKDAY_TIME = perLocale(locale => new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit', ...hourCycle() }));
const DAY = perLocale(locale => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }));
const DAY_TIME = perLocale(
    locale => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...hourCycle() }),
);

/**
 * A bin's two labels: the short one an axis tick has room for, and the full one a tooltip shows.
 * The axis follows the range: a clock for a day, a weekday for a week, a date beyond.
 */
function labelsFor(at: DateTime, range: TrendRange): { tick: string; full: string } {
    const date = at.toJSDate();
    if (range === '6h' || range === '24h') return { tick: TIME().format(date), full: DAY_TIME().format(date) };
    if (range === '7d') return { tick: WEEKDAY_TIME().format(date), full: DAY_TIME().format(date) };
    return { tick: DAY().format(date), full: DAY_TIME().format(date) };
}

/**
 * Bins become chart rows keyed by the full label, with a lookup from that label back to the short
 * one, because the axis and the tooltip both read the row's `dataKey` and only the axis is short of room.
 */
function chartRows(bins: readonly Bin[][], keys: readonly string[], value: (bin: Bin) => number | undefined, range: TrendRange) {
    const ticks = new Map<string, string>();
    const first = bins[0] ?? [];
    const rows = first.map((bin, index) => {
        const { tick, full } = labelsFor(bin.at, range);
        ticks.set(full, tick);
        const row: ChartRow = { when: full };
        keys.forEach((key, k) => {
            const own = bins[k]?.[index];
            row[key] = own === undefined ? null : (value(own) ?? null);
        });
        return row;
    });
    return { rows, tickFormatter: (full: string) => ticks.get(full) ?? full };
}

type ChartRow = Record<string, string | number | null>;

/**
 * A dot for a reading with nothing measured either side of it, and nothing for the rest.
 *
 * Gaps are kept (`connectNulls={false}`) so a stretch the station was down is drawn as one, and dots
 * are off so a dense line stays a line. Together those make a lone reading, a line from a point to
 * itself, invisible: the first minute on a new install, a gauge read every fifteen minutes on a range
 * drawn by the minute, a service that sent once. This draws exactly those.
 */
function isolatedDot(rows: readonly ChartRow[], color: string | undefined) {
    // Recharts wants an element for every point, so a point that is not lone gets an empty group.
    return function IsolatedDot(props: { cx?: number; cy?: number; index?: number; dataKey?: unknown }) {
        const key = String(props.dataKey);
        const index = props.index ?? -1;
        const here = rows[index]?.[key];
        const lone = here != null && rows[index - 1]?.[key] == null && rows[index + 1]?.[key] == null;
        if (!lone || props.cx === undefined || props.cy === undefined) return <g key={`${key}-${index}`} />;
        return <circle key={`${key}-${index}`} cx={props.cx} cy={props.cy} r={4} fill={color} stroke="var(--da-panel)" strokeWidth={2} />;
    };
}

/**
 * How the station's numbers have moved: the audience, the model, the work and the library.
 *
 * Each section reads its own query, on Check-up's rule that a page about what is wrong must not let one
 * dead reader blank it: a section that cannot be read says so in its own box. The station picks the
 * resolution; this folds whatever comes back into at most 120 points per chart so a bar is wide
 * enough to hover, and keeps every empty stretch as a gap rather than drawing a line across it.
 */
export function TrendsPage() {
    const { t } = useTranslation('trends');
    const signedIn = useSignedIn();
    const [range, setRange] = useState<TrendRange>('24h');

    const audience = useMetricSeries([TREND_METRICS.listeners], range, signedIn);
    const model = useMetricSeries(
        [TREND_METRICS.modelInputTokens, TREND_METRICS.modelOutputTokens, TREND_METRICS.modelMs, TREND_METRICS.failed],
        range,
        signedIn,
    );
    const work = useMetricSeries([TREND_METRICS.jobMs, TREND_METRICS.pluginMs, TREND_METRICS.failed], range, signedIn);
    const library = useMetricSeries(
        [TREND_METRICS.libraryTotal, TREND_METRICS.libraryCached, TREND_METRICS.libraryMeasured, TREND_METRICS.diskBytes],
        range,
        signedIn,
    );

    return (
        <Stack gap="lg">
            <PageHeader
                title={t('title')}
                description={
                    <Text size="sm" c="dimmed">
                        {t('description')}
                    </Text>
                }
                actions={
                    <SegmentedControl
                        aria-label={t('range.label')}
                        value={range}
                        onChange={value => setRange(value as TrendRange)}
                        data={TREND_RANGES.map(value => ({ value, label: t(`range.${value}`) }))}
                    />
                }
            />

            <Section title={t('section.audience')} query={audience}>
                {page => <Audience page={page} range={range} />}
            </Section>
            <Section title={t('section.model')} query={model}>
                {page => <Model page={page} range={range} />}
            </Section>
            <Section title={t('section.work')} query={work}>
                {page => <Work page={page} />}
            </Section>
            <Section title={t('section.library')} query={library}>
                {page => <Library page={page} range={range} />}
            </Section>
            <Received range={range} signedIn={signedIn} />
        </Stack>
    );
}

interface SectionQuery {
    isError: boolean;
    data?: MetricSeriesPage;
}

/** One part of the page, in a box that can fail, wait or be empty without taking the others. */
function Section({ title, query, children }: { title: string; query: SectionQuery; children: (page: MetricSeriesPage) => ReactNode }) {
    const { t } = useTranslation('trends');
    const page = query.data;
    const empty = page !== undefined && page.series.every(s => s.points.length === 0);

    return (
        <Stack gap="xs">
            <Eyebrow>{title}</Eyebrow>
            <Card padding="md">
                {query.isError ? (
                    <Text size="sm" c="red.4">
                        {t('section.failed')}
                    </Text>
                ) : page === undefined ? (
                    <Text size="sm" c="dimmed">
                        {t('section.reading')}
                    </Text>
                ) : empty ? (
                    <Text size="sm" c="dimmed">
                        {t('section.empty')}
                    </Text>
                ) : (
                    children(page)
                )}
            </Card>
        </Stack>
    );
}

/** A headline figure beside a chart: what the chart is about, read in one glance. */
function Figure({ label, value }: { label: string; value: string }) {
    return (
        <Stack gap={0}>
            <Text size="xs" c="dimmed">
                {label}
            </Text>
            <Text size="xl" fw={600} className="da-num">
                {value}
            </Text>
        </Stack>
    );
}

const bins = (page: MetricSeriesPage, series: MetricSeries[]) => binSeries(series, page.from, page.to, page.resolution);

function Audience({ page, range }: { page: MetricSeriesPage; range: TrendRange }) {
    const { t } = useTranslation('trends');
    const listeners = named(page.series, TREND_METRICS.listeners);
    const binned = bins(page, listeners);
    const whole = total(listeners);
    const latest = [...binned].reverse().find(bin => bin.point !== undefined)?.point;
    const { rows, tickFormatter } = chartRows([binned], ['listening'], bin => meanOf(bin.point), range);
    const dash = '—';

    return (
        <Stack gap="md">
            <Group gap="xl">
                <Figure label={t('audience.now')} value={latest === undefined ? dash : formatCount(latest.last)} />
                <Figure label={t('audience.peak')} value={whole === undefined ? dash : formatCount(whole.max)} />
                <Figure label={t('audience.average')} value={whole === undefined ? dash : formatCount(Math.round((meanOf(whole) ?? 0) * 10) / 10)} />
            </Group>
            <AreaChart
                h={CHART_HEIGHT}
                data={rows}
                dataKey="when"
                aria-label={t('audience.chartLabel')}
                series={[{ name: 'listening', label: t('audience.series'), color: SERIES_A }]}
                curveType="linear"
                connectNulls={false}
                areaProps={series => ({ dot: isolatedDot(rows, series.color) })}
                withDots={false}
                strokeWidth={2}
                fillOpacity={0.2}
                gridAxis="x"
                tickLine="none"
                xAxisProps={{ tickFormatter, minTickGap: 32 }}
                yAxisProps={{ allowDecimals: false }}
                valueFormatter={value => formatCount(Math.round(value * 10) / 10)}
            />
        </Stack>
    );
}

function Model({ page, range }: { page: MetricSeriesPage; range: TrendRange }) {
    const { t } = useTranslation('trends');
    const input = bins(page, named(page.series, TREND_METRICS.modelInputTokens));
    const output = bins(page, named(page.series, TREND_METRICS.modelOutputTokens));
    const calls = total(named(page.series, TREND_METRICS.modelMs));
    const failed = total(named(page.series, TREND_METRICS.failed).filter(s => s.labels.op === 'llm.generate'));
    const { rows, tickFormatter } = chartRows([input, output], ['input', 'output'], bin => bin.point?.sum, range);
    // How long the model takes to answer, so only the calls it answered: a timeout would drag the mean
    // up by minutes and a down model's instant refusals would pull it down. A minute filed before calls
    // carried an outcome has none, and is read as it always was.
    const meanCall = meanOf(total(named(page.series, TREND_METRICS.modelMs).filter(s => s.labels.outcome !== 'failed')));

    return (
        <Stack gap="md">
            <Group gap="xl">
                <Figure label={t('model.calls')} value={formatCount(calls?.count ?? 0)} />
                <Figure label={t('model.failed')} value={formatCount(failed?.sum ?? 0)} />
                <Figure label={t('model.meanCall')} value={meanCall === undefined ? '—' : formatSpent(meanCall)} />
            </Group>
            <BarChart
                h={CHART_HEIGHT}
                data={rows}
                dataKey="when"
                type="stacked"
                aria-label={t('model.chartLabel')}
                series={[
                    { name: 'input', label: t('model.input'), color: SERIES_A },
                    { name: 'output', label: t('model.output'), color: SERIES_B },
                ]}
                withLegend
                gridAxis="x"
                tickLine="none"
                xAxisProps={{ tickFormatter, minTickGap: 32 }}
                valueFormatter={value => formatCount(value)}
            />
        </Stack>
    );
}

function Work({ page }: { page: MetricSeriesPage }) {
    const { t } = useTranslation('trends');
    const jobs = rank(named(page.series, TREND_METRICS.jobMs), RANKED_ROWS);
    const plugins = rank(named(page.series, TREND_METRICS.pluginMs), RANKED_ROWS);
    const jobFailures = new Map(
        named(page.series, TREND_METRICS.failed)
            .filter(s => s.labels.op === 'job.run')
            .map(s => [s.labels.kind ?? '', total([s])?.sum ?? 0]),
    );

    return (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
            <Stack gap="xs">
                <Text size="sm" fw={500}>
                    {t('work.jobs')}
                </Text>
                <Table>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>{t('work.column.queue')}</Table.Th>
                            <Table.Th ta="right">{t('work.column.runs')}</Table.Th>
                            <Table.Th ta="right">{t('work.column.mean')}</Table.Th>
                            <Table.Th ta="right">{t('work.column.worst')}</Table.Th>
                            <Table.Th ta="right">{t('work.column.failed')}</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {jobs.map(row => (
                            <Table.Tr key={row.labels.queue}>
                                <Table.Td>{row.labels.queue}</Table.Td>
                                <Table.Td ta="right" className="da-num">
                                    {formatCount(row.point.count)}
                                </Table.Td>
                                <Table.Td ta="right" className="da-num">
                                    {formatSpent(row.point.sum / row.point.count)}
                                </Table.Td>
                                <Table.Td ta="right" className="da-num">
                                    {formatSpent(row.point.max)}
                                </Table.Td>
                                <Table.Td ta="right" className="da-num">
                                    {formatCount(jobFailures.get(row.labels.queue ?? '') ?? 0)}
                                </Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </Stack>
            <Stack gap="xs">
                <Text size="sm" fw={500}>
                    {t('work.plugins')}
                </Text>
                <Table>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>{t('work.column.plugin')}</Table.Th>
                            <Table.Th ta="right">{t('work.column.calls')}</Table.Th>
                            <Table.Th ta="right">{t('work.column.mean')}</Table.Th>
                            <Table.Th ta="right">{t('work.column.worst')}</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {plugins.map(row => (
                            <Table.Tr key={`${row.labels.plugin} ${row.labels.op}`}>
                                <Table.Td>{t('work.pluginCall', { plugin: row.labels.plugin ?? '', op: row.labels.op ?? '' })}</Table.Td>
                                <Table.Td ta="right" className="da-num">
                                    {formatCount(row.point.count)}
                                </Table.Td>
                                <Table.Td ta="right" className="da-num">
                                    {formatSpent(row.point.sum / row.point.count)}
                                </Table.Td>
                                <Table.Td ta="right" className="da-num">
                                    {formatSpent(row.point.max)}
                                </Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </Stack>
        </SimpleGrid>
    );
}

function Library({ page, range }: { page: MetricSeriesPage; range: TrendRange }) {
    const { t } = useTranslation('trends');
    const library = useMemo(
        () =>
            chartRows(
                [
                    bins(page, named(page.series, TREND_METRICS.libraryTotal)),
                    bins(page, named(page.series, TREND_METRICS.libraryCached)),
                    bins(page, named(page.series, TREND_METRICS.libraryMeasured)),
                ],
                ['total', 'cached', 'measured'],
                bin => bin.point?.last,
                range,
            ),
        [page, range],
    );
    const disk = chartRows([bins(page, named(page.series, TREND_METRICS.diskBytes))], ['bytes'], bin => bin.point?.last, range);

    return (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
            <LineChart
                h={CHART_HEIGHT}
                data={library.rows}
                dataKey="when"
                aria-label={t('library.chartLabel')}
                series={[
                    { name: 'total', label: t('library.total'), color: REFERENCE, strokeDasharray: '4 4' },
                    { name: 'cached', label: t('library.cached'), color: SERIES_A },
                    { name: 'measured', label: t('library.measured'), color: SERIES_B },
                ]}
                withLegend
                withDots={false}
                strokeWidth={2}
                curveType="linear"
                connectNulls={false}
                lineProps={series => ({ dot: isolatedDot(library.rows, series.color) })}
                gridAxis="x"
                tickLine="none"
                xAxisProps={{ tickFormatter: library.tickFormatter, minTickGap: 32 }}
                yAxisProps={{ allowDecimals: false }}
                valueFormatter={value => formatCount(value)}
            />
            <AreaChart
                h={CHART_HEIGHT}
                data={disk.rows}
                dataKey="when"
                aria-label={t('library.diskLabel')}
                series={[{ name: 'bytes', label: t('library.disk'), color: SERIES_A }]}
                withDots={false}
                strokeWidth={2}
                fillOpacity={0.2}
                curveType="linear"
                connectNulls={false}
                areaProps={series => ({ dot: isolatedDot(disk.rows, series.color) })}
                gridAxis="x"
                tickLine="none"
                xAxisProps={{ tickFormatter: disk.tickFormatter, minTickGap: 32 }}
                yAxisProps={{ tickFormatter: (value: number) => formatBytes(value), width: 72 }}
                valueFormatter={value => formatBytes(value)}
            />
        </SimpleGrid>
    );
}

/** The chart key a received metric is drawn under. A data key, not a word anybody reads. */
const RECEIVED_KEY = 'value';

/** How a received metric is read: a gauge or a duration by its average, a counter by its total. */
type Reading = 'mean' | 'total' | 'largest';

const READ: Record<Reading, (bin: Bin) => number | undefined> = {
    mean: bin => meanOf(bin.point),
    total: bin => bin.point?.sum,
    largest: bin => bin.point?.max,
};

/**
 * Metrics another service sent over OTLP, one at a time.
 *
 * Drawn only once something has been received, so a station that never turned receiving on never
 * sees an empty box for it. The station does not know what kind a received metric is (a gauge, a
 * counter, a duration all arrive as the same five numbers), so the operator says how to read it.
 * Every label set of the metric is folded into one line, as the station's own charts are.
 */
function Received({ range, signedIn }: { range: TrendRange; signedIn: boolean }) {
    const { t } = useTranslation('trends');
    const names = useMetricNames(signedIn);
    const received = useMemo(() => (names.data?.names ?? []).filter(name => name.source === 'otlp').map(name => name.name), [names.data]);
    const [chosen, setChosen] = useState<string | undefined>();
    const [reading, setReading] = useState<Reading>('mean');
    const name = chosen !== undefined && received.includes(chosen) ? chosen : received[0];
    const series = useMetricSeries(name === undefined ? [] : [name], range, signedIn && name !== undefined);

    if (name === undefined) return null;

    return (
        <Section title={t('section.received')} query={series}>
            {page => {
                const own = page.series.filter(s => s.source === 'otlp');
                const { rows, tickFormatter } = chartRows([bins(page, own)], [RECEIVED_KEY], READ[reading], range);
                return (
                    <Stack gap="md">
                        <Text size="sm" c="dimmed">
                            {t('received.hint')}
                        </Text>
                        <Group gap="md" align="end" wrap="wrap">
                            <Select
                                label={t('received.metric')}
                                data={received}
                                value={name}
                                onChange={value => setChosen(value ?? undefined)}
                                allowDeselect={false}
                                searchable
                            />
                            <SegmentedControl
                                aria-label={t('received.reading')}
                                value={reading}
                                onChange={value => setReading(value as Reading)}
                                data={(['mean', 'total', 'largest'] as const).map(value => ({ value, label: t(`received.${value}`) }))}
                            />
                        </Group>
                        <LineChart
                            h={CHART_HEIGHT}
                            data={rows}
                            dataKey="when"
                            aria-label={t('received.chartLabel')}
                            series={[{ name: RECEIVED_KEY, label: t('received.series'), color: SERIES_A }]}
                            withDots={false}
                            strokeWidth={2}
                            curveType="linear"
                            connectNulls={false}
                            lineProps={series => ({ dot: isolatedDot(rows, series.color) })}
                            gridAxis="x"
                            tickLine="none"
                            xAxisProps={{ tickFormatter, minTickGap: 32 }}
                            valueFormatter={value => formatCount(Math.round(value * 100) / 100)}
                        />
                    </Stack>
                );
            }}
        </Section>
    );
}
