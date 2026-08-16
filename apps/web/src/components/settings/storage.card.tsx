import { Card, Group, Progress, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import type { StorageStore } from '@deadair/sdk';

import { useStorage } from '../../api/storage.queries';
import { ErrorAlert } from '../shared/error.alert';
import { formatBytes } from '../shared/format.bytes';

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
    const storage = useStorage();

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap={4}>
                    <Title order={2} size="h4">
                        Disk
                    </Title>
                    <Text size="sm" c="dimmed">
                        What the station is keeping, and where. Records are the only one with a limit; the rest grow with the library and with how
                        much the station has said.
                    </Text>
                </Stack>

                {storage.error ? (
                    <ErrorAlert title="Disk figures unavailable" error={storage.error} fallback="The station could not read what is on disk." />
                ) : undefined}

                {storage.data ? (
                    <>
                        <Table verticalSpacing="xs" horizontalSpacing="sm">
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Store</Table.Th>
                                    <Table.Th ta="right">On disk</Table.Th>
                                    <Table.Th ta="right">Files</Table.Th>
                                    <Table.Th ta="right">Unclaimed</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {storage.data.stores.map(store => (
                                    <StoreRow key={store.id} store={store} />
                                ))}
                            </Table.Tbody>
                            <Table.Tfoot>
                                <Table.Tr>
                                    <Table.Th>Everything</Table.Th>
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

                        <Text size="xs" c="dimmed">
                            Read {new Date(storage.data.readAt).toLocaleTimeString()}. Walking the directories is real work, so this is a reading
                            rather than a live figure. Nothing here is deleted automatically: a file no row claims and a record whose file has gone
                            are both reported and left alone.
                        </Text>
                    </>
                ) : undefined}
            </Stack>
        </Card>
    );
}

function StoreRow({ store }: { store: StorageStore }) {
    // Only the record cache has a limit today, and only while an operator has set one.
    const capped = store.capBytes !== undefined && store.capBytes > 0;
    const used = capped ? Math.min(100, Math.round((store.bytes / store.capBytes!) * 100)) : 0;

    return (
        <Table.Tr>
            <Table.Td>
                <Stack gap={2}>
                    <Text size="sm">{store.label}</Text>
                    <Text size="xs" c="dimmed">
                        {store.path}
                    </Text>
                    {capped ? (
                        <Group gap="xs" wrap="nowrap" mt={4}>
                            <Progress value={used} w={120} size="sm" color={used >= 100 ? 'yellow' : 'teal'} aria-label="Share of the limit in use" />
                            <Text size="xs" c="dimmed" className="da-num">
                                {used}% of {formatBytes(store.capBytes)}
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
                    <Tooltip label="Rows pointing at a file that is not there. The station fetches or renders these again when it needs them.">
                        <Text span size="xs" c="yellow" ml={6}>
                            {store.rowsWithNoFile} missing
                        </Text>
                    </Tooltip>
                ) : undefined}
            </Table.Td>
            <Table.Td ta="right" className="da-num">
                {store.orphanFiles > 0 ? (
                    <Tooltip label="Files no row claims — usually left by a write that was interrupted. Nothing deletes them.">
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
