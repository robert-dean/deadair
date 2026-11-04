import { Stack, Table, Text } from '@mantine/core';
import type { ScriptPerformanceRow } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { PERFORMANCE_DAYS, useScriptPerformance } from '../../api/scripts.queries';
import { EmptyState } from '../shared/empty.state';
import { Eyebrow } from '../shared/eyebrow';
import { PageSkeleton } from '../shared/page.skeleton';
import { QueryView } from '../shared/query.view';

/** Decline reasons across every kind of break, most common first. */
function reasonsAcross(rows: readonly ScriptPerformanceRow[]): { reason: string; count: number }[] {
    const reasons = new Map<string, number>();
    for (const row of rows) {
        for (const { reason, count } of row.declineReasons) reasons.set(reason, (reasons.get(reason) ?? 0) + count);
    }
    return [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

/**
 * How a character's breaks are doing, by the checks and by the operator.
 *
 * Reasons and ratings sit together on purpose. A sheet tuned only to lower its declines drifts toward
 * passing the checks, and the ratings are what say whether the breaks that passed were any good.
 * A break nobody rated counts as written and in neither opinion column, since most never get heard back.
 */
export function PersonaPerformancePanel({ personaKey }: { personaKey: string }) {
    const { t } = useTranslation('personas');
    const performance = useScriptPerformance();

    return (
        <QueryView
            query={performance}
            skeleton={<PageSkeleton variant="card" />}
            errorTitle={t('performance.loadError')}
            errorFallback={t('performance.loadErrorFallback')}
            isEmpty={({ rows }) => !rows.some(row => row.personaKey === personaKey)}
            empty={<EmptyState>{t('performance.empty', { days: PERFORMANCE_DAYS })}</EmptyState>}
        >
            {({ rows: all }) => {
                const rows = all.filter(row => row.personaKey === personaKey).sort((a, b) => b.written - a.written);
                const reasons = reasonsAcross(rows);

                return (
                    <Stack gap="sm" mt="sm">
                        <Eyebrow>{t('performance.title', { days: PERFORMANCE_DAYS })}</Eyebrow>
                        <Table>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('performance.column.kind')}</Table.Th>
                                    <Table.Th ta="right">{t('performance.column.written')}</Table.Th>
                                    <Table.Th ta="right">{t('performance.column.declined')}</Table.Th>
                                    <Table.Th ta="right">{t('performance.column.failed')}</Table.Th>
                                    <Table.Th ta="right">{t('performance.column.liked')}</Table.Th>
                                    <Table.Th ta="right">{t('performance.column.neutral')}</Table.Th>
                                    <Table.Th ta="right">{t('performance.column.disliked')}</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {rows.map(row => (
                                    <Table.Tr key={row.kind}>
                                        <Table.Td>{row.kind}</Table.Td>
                                        {[row.written, row.declined, row.failed, row.liked, row.neutral, row.disliked].map((value, column) => (
                                            <Table.Td key={column} ta="right" className="da-num">
                                                {value}
                                            </Table.Td>
                                        ))}
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                        {reasons.length > 0 ? (
                            <Stack gap={4}>
                                <Eyebrow>{t('performance.reasons')}</Eyebrow>
                                {reasons.map(({ reason, count }) => (
                                    <Text key={reason} size="xs" c="dimmed">
                                        {t('performance.reason', { count, reason })}
                                    </Text>
                                ))}
                            </Stack>
                        ) : undefined}
                    </Stack>
                );
            }}
        </QueryView>
    );
}
