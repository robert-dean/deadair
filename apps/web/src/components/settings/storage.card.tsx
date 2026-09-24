import { Card, Group, Progress, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { StorageStore } from '@deadair/sdk';

import { useStorage } from '../../api/storage.queries';
import { ErrorAlert } from '../shared/error.alert';
import { formatTimeOfDay } from '../shared/feed.moment';
import { formatBytes } from '../shared/format.bytes';
import { PhoneCard } from '../shared/phone.card';
import { usePhone } from '../shared/use.phone';

/**
 * What the station is using the disk for.
 *
 * On the settings page rather than a page of its own, and directly under Playout, because the one
 * number here an operator can DO anything about is the cache limit in that section — and a limit is
 * a number you type against something. Four stores share one volume and until this there was no way
 * to see any of them short of `du`.
 *
 * ## Two figures, not one
 *
 * What is on disk and what the database claims are separate columns. They disagree in two directions
 * and each means something different: bytes no row claims are what a crash between writing a file
 * and writing its row leaves behind, and a row whose file has gone is what emptying a directory
 * leaves. Reconciling them into one number here would hide both, and neither is repaired
 * automatically — see the API's own note.
 *
 * The unclaimed line only appears when there is something to say. A row of zeroes on every store is
 * noise on the one page an operator scans for a number.
 */
export function StorageCard() {
    const { t } = useTranslation('settings');
    const storage = useStorage();
    const phone = usePhone();

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {t('storage.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('storage.intro')}
                    </Text>
                </Stack>

                {storage.error ? (
                    <ErrorAlert title={t('storage.unavailable.title')} error={storage.error} fallback={t('storage.unavailable.fallback')} />
                ) : undefined}

                {phone && storage.data ? (
                    <Stack gap="xxs">
                        {storage.data.stores.map(store => (
                            <StoreCard key={store.id} store={store} />
                        ))}

                        {/* The foot row, which is not a store and is not drawn as one. Two figures
                            on one line because that is all the table's foot ever carried. */}
                        <Group justify="space-between" wrap="nowrap" px="xs" pt="xxs">
                            <Text size="sm" fw={500}>
                                {t('storage.everything')}
                            </Text>
                            <Text size="sm" className="da-num">
                                {t('storage.totals', { bytes: formatBytes(storage.data.totalBytes), files: storage.data.totalFiles })}
                            </Text>
                        </Group>
                    </Stack>
                ) : undefined}

                {!phone && storage.data ? (
                    <Table.ScrollContainer minWidth={550}>
                        <Table verticalSpacing="xs" horizontalSpacing="sm">
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('storage.column.store')}</Table.Th>
                                    <Table.Th ta="right">{t('storage.column.onDisk')}</Table.Th>
                                    <Table.Th ta="right">{t('storage.column.files')}</Table.Th>
                                    <Table.Th ta="right">{t('storage.column.unclaimed')}</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {storage.data.stores.map(store => (
                                    <StoreRow key={store.id} store={store} />
                                ))}
                            </Table.Tbody>
                            <Table.Tfoot>
                                <Table.Tr>
                                    <Table.Th>{t('storage.everything')}</Table.Th>
                                    <Table.Th ta="right" className="da-num">
                                        {formatBytes(storage.data.totalBytes)}
                                    </Table.Th>
                                    <Table.Th ta="right" className="da-num">
                                        {storage.data.totalFiles}
                                    </Table.Th>
                                    <Table.Th />
                                </Table.Tr>
                            </Table.Tfoot>
                        </Table>
                    </Table.ScrollContainer>
                ) : undefined}

                {storage.data ? (
                    <Text size="xs" c="dimmed">
                        {t('storage.footnote', { time: formatTimeOfDay(storage.data.readAt) })}
                    </Text>
                ) : undefined}
            </Stack>
        </Card>
    );
}

/**
 * How much of a store's limit is gone, or nothing when it has no limit.
 *
 * Only the record cache has one today, and only while an operator has set it. Answered here rather
 * than in each shape, so the desk row and the phone card cannot end up rounding a percentage two
 * ways. Bound to a local so the guard narrows `capBytes`, rather than asserting past a check that
 * already answered.
 */
function capShare(store: StorageStore): { used: number; cap: number } | undefined {
    const cap = store.capBytes;
    if (cap === undefined || cap <= 0) return undefined;
    return { used: Math.min(100, Math.round((store.bytes / cap) * 100)), cap };
}

function StoreRow({ store }: { store: StorageStore }) {
    const { t } = useTranslation('settings');
    const share = capShare(store);

    return (
        <Table.Tr>
            <Table.Td>
                <Stack gap="xxxs">
                    <Text size="sm">{store.label}</Text>
                    <Text size="xs" c="dimmed">
                        {store.path}
                    </Text>
                    {share ? (
                        <Group gap="xs" wrap="nowrap" mt="xxs">
                            <Progress
                                value={share.used}
                                w={120}
                                size="sm"
                                color={share.used >= 100 ? 'yellow' : 'teal'}
                                aria-label={t('storage.share.label')}
                            />
                            <Text size="xs" c="dimmed" className="da-num">
                                {t('storage.share.of', { used: share.used, cap: formatBytes(share.cap) })}
                            </Text>
                        </Group>
                    ) : undefined}
                </Stack>
            </Table.Td>
            <Table.Td ta="right" className="da-num">
                {formatBytes(store.bytes)}
            </Table.Td>
            <Table.Td ta="right" className="da-num">
                {store.files}
                {store.rowsWithNoFile > 0 ? (
                    <Tooltip label={t('storage.missing.tooltip')}>
                        <Text span size="xs" c="yellow" ml="xxs">
                            {t('storage.missing.count', { rows: store.rowsWithNoFile })}
                        </Text>
                    </Tooltip>
                ) : undefined}
            </Table.Td>
            <Table.Td ta="right" className="da-num">
                {store.orphanFiles > 0 ? (
                    <Tooltip label={t('storage.unclaimed.tooltip')}>
                        <Text span size="sm" c="dimmed">
                            {formatBytes(store.orphanBytes)}
                        </Text>
                    </Tooltip>
                ) : (
                    <Text span size="sm" c="dimmed">
                        —
                    </Text>
                )}
            </Table.Td>
        </Table.Tr>
    );
}

/**
 * One store, on a phone.
 *
 * The label, where it is and what it weighs stay on the main line; the two columns that were
 * reconciliation rather than size — the file count and what nothing claims — fold into a fact line
 * under it. They fold into WORDS rather than figures under a heading, because the desk explains
 * both through a tooltip and a phone has no hover: "missing" and "unclaimed" have to carry their own
 * meaning here, and the card's footnote carries the rest.
 */
function StoreCard({ store }: { store: StorageStore }) {
    const { t } = useTranslation('settings');
    const share = capShare(store);

    return (
        <PhoneCard
            title={
                <Text size="sm" truncate>
                    {store.label}
                </Text>
            }
            subtitle={
                <Text size="xs" c="dimmed" truncate>
                    {store.path}
                </Text>
            }
            figure={
                <Text size="sm" className="da-num">
                    {formatBytes(store.bytes)}
                </Text>
            }
            below={
                <Stack gap="xxs" mt="xxs">
                    <Group gap="xs" wrap="wrap">
                        <Text size="xs" c="dimmed" className="da-num">
                            {t('storage.files', { count: store.files })}
                        </Text>
                        {store.rowsWithNoFile > 0 ? (
                            <Text size="xs" c="yellow" className="da-num">
                                {t('storage.missing.count', { rows: store.rowsWithNoFile })}
                            </Text>
                        ) : undefined}
                        {store.orphanFiles > 0 ? (
                            <Text size="xs" c="dimmed" className="da-num">
                                {t('storage.unclaimed.amount', { bytes: formatBytes(store.orphanBytes) })}
                            </Text>
                        ) : undefined}
                    </Group>
                    {share ? (
                        <Group gap="xs" wrap="nowrap">
                            <Progress
                                value={share.used}
                                flex={1}
                                size="sm"
                                color={share.used >= 100 ? 'yellow' : 'teal'}
                                aria-label={t('storage.share.label')}
                            />
                            <Text size="xs" c="dimmed" className="da-num">
                                {t('storage.share.of', { used: share.used, cap: formatBytes(share.cap) })}
                            </Text>
                        </Group>
                    ) : undefined}
                </Stack>
            }
        />
    );
}
