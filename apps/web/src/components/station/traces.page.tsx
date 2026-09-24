import { useState } from 'react';
import { Badge, Code, Drawer, Group, SegmentedControl, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconArrowUpRight } from '@tabler/icons-react';
import type { TraceDecision, TraceSpan } from '@deadair/sdk';
import { Trans, useTranslation } from 'react-i18next';

import { useTrace, useTraces } from '../../api/station.queries';
import { describeDecision } from './decision.words';
import { FeedMoment } from '../shared/dated.feed';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageSkeleton } from '../shared/page.skeleton';
import { PhoneCard } from '../shared/phone.card';
import { usePhone } from '../shared/use.phone';
import { severityColor } from '../shared/status';

/**
 * A duration where the interesting range spans four orders of magnitude.
 *
 * `formatDuration` next door is `m:ss` and is right for a record; it is useless here, where the
 * honest answers are "3ms" and "19.2s" on adjacent rows. Sub-second stays in milliseconds because a
 * plugin call that took 40ms and one that took 400 are a different conversation, and anything past a
 * second rounds to a tenth because nobody reading a 19-second generation cares about its last 43.
 */
function formatSpent(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;

    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * What the station did, decision by decision, and what each one cost.
 *
 * ## Why this is a table and the feed beside it is not
 *
 * `/activity` is a list of sentences, because every row there is one thing that happened and the
 * interesting part is the wording. Every row here is four numbers about one decision, and the
 * question an operator brings is comparative — which of these cost the most, which of them failed.
 * A column of figures answers that at a glance and a column of prose does not.
 *
 * ## The tree is the point
 *
 * A job that enqueues another is two decisions, and read as two unrelated rows an enrichment walk
 * that spends two minutes in the fact extraction it queued is a walk and a mystery. Children are
 * drawn indented under whatever caused them, and a decision whose parent has rotated out of the kept
 * window is drawn at the top level rather than dropped — the edge was real and the other end is gone.
 *
 * ## It does not poll
 *
 * Unlike everything else on Check-up. These rows were written when the work happened and cannot
 * change, so a timer would re-read the whole window to learn what it already knows.
 */
export function TracesPage() {
    const { t } = useTranslation('station');
    const [failedOnly, setFailedOnly] = useState(false);
    const [open, setOpen] = useState<string | undefined>(undefined);

    // Read here rather than in `DecisionTable`, which mounts only once the rows have arrived: by
    // then the answer must already be settled, or the table's first paint is a desk-shaped frame
    // the phone replaces a beat later. This page is mounted before any data, where that one
    // corrected frame is the hook's documented, accepted cost.
    const phone = usePhone();

    const traces = useTraces({ ...(failedOnly ? { failedOnly: true } : {}) });

    if (traces.isPending) return <PageSkeleton variant="table" />;
    if (traces.isError) return <ErrorAlert title={t('traces.loadFailedTitle')} error={traces.error} fallback={t('traces.loadFailedFallback')} />;

    const { decisions, total, spans } = traces.data;

    return (
        <Stack gap="md">
            <Group justify="space-between" align="flex-end">
                <Text size="sm" c="dimmed" maw={640}>
                    {t('traces.description')}
                </Text>
                <SegmentedControl
                    size="xs"
                    value={failedOnly ? 'failed' : 'all'}
                    onChange={value => setFailedOnly(value === 'failed')}
                    data={[
                        { value: 'all', label: t('traces.filter.all') },
                        { value: 'failed', label: t('traces.filter.failed') },
                    ]}
                />
            </Group>

            {decisions.length === 0 ? (
                <EmptyState title={failedOnly ? t('traces.noFailuresTitle') : t('traces.emptyTitle')}>
                    {failedOnly ? t('traces.noFailures') : t('traces.empty')}
                </EmptyState>
            ) : (
                <>
                    <DecisionTable decisions={decisions} phone={phone} onOpen={setOpen} />
                    <Text size="xs" c="dimmed">
                        {t('traces.showing', { shown: decisions.length, count: total, calls: t('traces.recordedCalls', { count: spans }) })}
                    </Text>
                </>
            )}

            <TraceDrawer id={open} onClose={() => setOpen(undefined)} />
        </Stack>
    );
}

/** The forest: roots by what they last did, and whatever each one caused indented beneath it. */
function DecisionTable({ decisions, phone, onOpen }: { decisions: TraceDecision[]; phone: boolean; onOpen: (id: string) => void }) {
    const { t } = useTranslation('station');
    const byId = new Map(decisions.map(decision => [decision.id, decision]));
    const childrenOf = new Map<string, TraceDecision[]>();
    for (const decision of decisions) {
        if (decision.parent === undefined) continue;
        childrenOf.set(decision.parent, [...(childrenOf.get(decision.parent) ?? []), decision]);
    }

    // A parent outside the window leaves its children as roots rather than hiding them, which is the
    // honest reading: the edge is real and the other end has rotated away.
    const roots = decisions.filter(decision => decision.parent === undefined || !byId.has(decision.parent));

    const rows: { decision: TraceDecision; depth: number }[] = [];
    const walk = (decision: TraceDecision, depth: number) => {
        rows.push({ decision, depth });
        for (const child of childrenOf.get(decision.id) ?? []) walk(child, depth + 1);
    };
    for (const root of roots) walk(root, 0);

    // The phone gets cards rather than a table that scrolls sideways: same walk, same order, and
    // the whole card opens the drawer the row's click did. The indent survives as the card's own
    // depth, because the causal edge is the point of this page; the short id is the one dropped
    // column, being a debugging handle rather than something read at a glance.
    if (phone) {
        return (
            <Stack gap="xxs">
                {rows.map(({ decision, depth }) => (
                    <PhoneCard
                        key={decision.id}
                        depth={depth}
                        onClick={() => onOpen(decision.id)}
                        aria-label={t('traces.open', { decision: describeDecision(decision.kind).sentence })}
                        leading={<FeedMoment at={decision.at} />}
                        title={
                            <>
                                {depth > 0 ? (
                                    <IconArrowUpRight
                                        size={13}
                                        stroke={1.8}
                                        style={{ transform: 'rotate(90deg)', opacity: 0.5, flexShrink: 0 }}
                                        aria-hidden
                                    />
                                ) : undefined}
                                <Text size="sm" truncate>
                                    {describeDecision(decision.kind).sentence}
                                </Text>
                            </>
                        }
                        subtitle={
                            <>
                                <Text size="xs" c="dimmed" className="da-num">
                                    {t('traces.calls', { count: decision.calls })}
                                </Text>
                                {decision.failed > 0 ? (
                                    <Badge size="sm" color={severityColor.failure} variant="light" className="da-num" style={{ flexShrink: 0 }}>
                                        {decision.failed}
                                    </Badge>
                                ) : undefined}
                            </>
                        }
                        figure={
                            <Text size="sm" className="da-num" c={decision.ms === 0 ? 'dimmed' : undefined}>
                                {decision.ms === 0 ? '—' : formatSpent(decision.ms)}
                            </Text>
                        }
                    />
                ))}
            </Stack>
        );
    }

    return (
        <Table.ScrollContainer minWidth={650}>
            <Table highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th w={120}>{t('traces.column.when')}</Table.Th>
                        <Table.Th>{t('traces.column.decision')}</Table.Th>
                        <Table.Th w={90}>{t('traces.column.spent')}</Table.Th>
                        <Table.Th w={80}>{t('traces.column.calls')}</Table.Th>
                        <Table.Th w={90}>{t('traces.column.failed')}</Table.Th>
                        <Table.Th w={50} />
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {rows.map(({ decision, depth }) => {
                        const reading = describeDecision(decision.kind);
                        return (
                            <Table.Tr key={decision.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(decision.id)}>
                                <Table.Td>
                                    <FeedMoment at={decision.at} />
                                </Table.Td>
                                <Table.Td>
                                    {/* The indent is the causal edge and nothing else carries it, so a child
                                also says so in words: an operator scanning a column of names should
                                not have to measure whitespace to know one thing caused another. */}
                                    <Group gap="xs" wrap="nowrap" style={{ paddingLeft: depth * 20 }}>
                                        {depth > 0 ? (
                                            <Tooltip label={t('traces.enqueuedBy')}>
                                                <IconArrowUpRight size={13} stroke={1.8} style={{ transform: 'rotate(90deg)', opacity: 0.5 }} />
                                            </Tooltip>
                                        ) : undefined}
                                        <Stack gap={0}>
                                            <Text size="sm">{reading.sentence}</Text>
                                            {/* The raw kind stays, dimmed, EXCEPT for a request — which
                                            already reads as `GET /voices` in the sentence itself, so
                                            repeating it underneath would be the same fact twice. */}
                                            {reading.source === 'request' ? undefined : (
                                                <Text size="xs" c="dimmed" ff="monospace">
                                                    {decision.kind}
                                                </Text>
                                            )}
                                        </Stack>
                                    </Group>
                                </Table.Td>
                                <Table.Td>
                                    {/* Zero is a decision recorded before the station wrote a span for the
                                job itself, not a decision that took no time. Saying so beats a `0ms`
                                that reads as a measurement. */}
                                    <Text size="sm" className="da-num" c={decision.ms === 0 ? 'dimmed' : undefined}>
                                        {decision.ms === 0 ? '—' : formatSpent(decision.ms)}
                                    </Text>
                                </Table.Td>
                                <Table.Td>
                                    <Text size="sm" className="da-num">
                                        {decision.calls}
                                    </Text>
                                </Table.Td>
                                <Table.Td>
                                    {decision.failed > 0 ? (
                                        <Badge size="sm" color={severityColor.failure} variant="light" className="da-num">
                                            {decision.failed}
                                        </Badge>
                                    ) : undefined}
                                </Table.Td>
                                <Table.Td>
                                    <Text size="xs" c="dimmed" className="da-num">
                                        {decision.id.slice(0, 8)}
                                    </Text>
                                </Table.Td>
                            </Table.Tr>
                        );
                    })}
                </Table.Tbody>
            </Table>
        </Table.ScrollContainer>
    );
}

/** One decision, opened: its calls in order, and the decisions on either side of it. */
function TraceDrawer({ id, onClose }: { id: string | undefined; onClose: () => void }) {
    const { t } = useTranslation('station');
    const trace = useTrace(id);
    const phone = usePhone();

    return (
        <Drawer
            opened={id !== undefined}
            onClose={onClose}
            position="right"
            size={phone ? '100%' : 'xl'}
            title={
                trace.data === undefined
                    ? t('traces.drawerTitle')
                    : (() => {
                          const reading = describeDecision(trace.data.decision.kind);
                          return (
                              <Stack gap={0}>
                                  <Text fw={600}>{reading.sentence}</Text>
                                  {reading.source === 'request' ? undefined : (
                                      <Text size="xs" c="dimmed" ff="monospace">
                                          {trace.data.decision.kind}
                                      </Text>
                                  )}
                              </Stack>
                          );
                      })()
            }
        >
            {trace.isPending ? <PageSkeleton variant="rows" count={6} /> : undefined}
            {trace.isError ? (
                <ErrorAlert title={t('traces.drawerFailedTitle')} error={trace.error} fallback={t('traces.drawerFailedFallback')} />
            ) : undefined}
            {trace.data ? (
                <Stack gap="md">
                    <Stack gap="xxs">
                        <Text size="xs" c="dimmed" className="da-num">
                            {trace.data.decision.id}
                        </Text>
                        {trace.data.parent ? (
                            <Text size="sm" c="dimmed">
                                <Trans t={t} i18nKey="traces.causedBy" values={{ kind: trace.data.parent.kind }} components={{ code: <Code /> }} />
                            </Text>
                        ) : undefined}
                        {trace.data.decision.parent !== undefined && trace.data.parent === undefined ? (
                            <Text size="sm" c="dimmed">
                                {t('traces.causedByGone')}
                            </Text>
                        ) : undefined}
                        {trace.data.caused.length > 0 ? (
                            <Text size="sm" c="dimmed">
                                {t('traces.enqueued', { kinds: trace.data.caused.map(child => child.kind).join(', ') })}
                            </Text>
                        ) : undefined}
                    </Stack>

                    <SpanList spans={trace.data.spans} />
                </Stack>
            ) : undefined}
        </Drawer>
    );
}

/** Every call, in the order it happened. */
function SpanList({ spans }: { spans: TraceSpan[] }) {
    const { t } = useTranslation('station');
    return (
        <Table verticalSpacing="xs">
            <Table.Thead>
                <Table.Tr>
                    <Table.Th w={90}>{t('traces.column.spent')}</Table.Th>
                    <Table.Th>{t('traces.column.call')}</Table.Th>
                </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
                {spans.map((span, index) => (
                    <Table.Tr key={`${span.at.toISO()}-${index}`}>
                        <Table.Td>
                            <Text size="sm" className="da-num" c={span.outcome === 'failed' ? severityColor.failure : undefined}>
                                {formatSpent(span.ms)}
                            </Text>
                        </Table.Td>
                        <Table.Td>
                            <Stack gap={2}>
                                <Group gap="xs" wrap="nowrap">
                                    <Text size="sm">{span.op}</Text>
                                    {span.target ? (
                                        <Text size="sm" c="dimmed">
                                            {span.target}
                                        </Text>
                                    ) : undefined}
                                </Group>
                                {span.error ? (
                                    <Text size="xs" c={severityColor.failure}>
                                        {span.error}
                                    </Text>
                                ) : undefined}
                                {/* The op-specific half — tokens, a finish reason, the timeout the
                                    call was given — rendered as it was recorded rather than given a
                                    shape per op. What is worth reading differs per op and this page
                                    is not the thing that should decide which of them matter. */}
                                {span.detail ? (
                                    <Text size="xs" c="dimmed" className="da-num">
                                        {Object.entries(span.detail)
                                            .map(([key, value]) => `${key}=${String(value)}`)
                                            .join('  ')}
                                    </Text>
                                ) : undefined}
                            </Stack>
                        </Table.Td>
                    </Table.Tr>
                ))}
            </Table.Tbody>
        </Table>
    );
}
