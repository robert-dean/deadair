import { Badge, Stack, Table, Text, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { ListenerConnection, UnreadableMount } from '@deadair/sdk';

import { useStreamListeners } from '../../api/stream.queries';
import { isForbidden } from '../../api/sdk.error';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { formatDuration } from '../shared/format.duration';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { StatusLamp } from '../shared/status.lamp';

/**
 * Who is listening, connection by connection: the Icecast mounts and the HLS players.
 *
 * The count is everywhere (the tally in the chrome says it on every page), so this is the list
 * behind it, for the moment an operator wants to know whether that one listener is them, a friend,
 * or a bot. It is read while the page is open and never kept: the station asks Icecast when this
 * page asks the station.
 *
 * Two things it is careful to say rather than hide. A mount the station could not read is named,
 * because a list missing a mount's listeners would otherwise read as a mount with nobody on it. And
 * the station's own count stands beside the list when the two differ, since they are separate
 * readings and an operator comparing them should be told why rather than left to wonder which is
 * wrong.
 *
 * The console does not know who is an admin, so nothing hides this page from a listener account:
 * the station answers such an account 403, and the page says so in its own words.
 */
export function ListenersPage() {
    const { t } = useTranslation('station');
    const listeners = useStreamListeners();
    const reading = listeners.data;

    return (
        <Stack gap="lg">
            <PageHeader
                title={t('listeners.title')}
                description={
                    <Text size="sm" c="dimmed">
                        {t('listeners.description')}
                    </Text>
                }
            >
                {reading ? (
                    <StatusLamp tone={reading.total > 0 ? 'ok' : 'off'} label={t('listeners.count', { count: reading.total })} emphasis="chip" />
                ) : undefined}
            </PageHeader>

            {listeners.isError && !reading ? (
                isForbidden(listeners.error) ? (
                    <ErrorAlert tone="notice">{t('listeners.forbidden')}</ErrorAlert>
                ) : (
                    <ErrorAlert error={listeners.error} fallback={t('listeners.failure')} />
                )
            ) : undefined}
            {listeners.isPending ? <PageSkeleton variant="rows" count={3} /> : undefined}

            {reading && reading.unreadable.length > 0 ? <UnreadableMounts mounts={reading.unreadable} /> : undefined}

            {reading && reading.connections.length === 0 && reading.unreadable.length === 0 && reading.total === 0 ? (
                <EmptyState>{t('listeners.empty')}</EmptyState>
            ) : undefined}

            {reading && reading.total !== reading.connections.length ? (
                <Text size="xs" c="dimmed">
                    {t('listeners.differs', { count: reading.total, listed: reading.connections.length })}
                </Text>
            ) : undefined}

            {reading && reading.connections.length > 0 ? <ConnectionTable connections={reading.connections} /> : undefined}
        </Stack>
    );
}

/** The mounts whose listeners are missing from the list, and why. */
function UnreadableMounts({ mounts }: { mounts: readonly UnreadableMount[] }) {
    const { t } = useTranslation('station');

    return (
        <ErrorAlert tone="warning" title={t('listeners.unreadable.title', { count: mounts.length })}>
            <Stack gap={4}>
                {mounts.map(mount => (
                    <Text key={mount.mount} size="sm">
                        {t(`listeners.unreadable.${mount.reason}`, { mount: mount.mount })}
                    </Text>
                ))}
            </Stack>
        </ErrorAlert>
    );
}

/** One row per connection, in the order the station listed them: Icecast mounts first, then HLS. */
function ConnectionTable({ connections }: { connections: readonly ListenerConnection[] }) {
    const { t } = useTranslation('station');

    return (
        <Table.ScrollContainer minWidth={620}>
            <Table verticalSpacing="xs">
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th w={130}>{t('listeners.column.stream')}</Table.Th>
                        <Table.Th w={200}>{t('listeners.column.address')}</Table.Th>
                        <Table.Th>{t('listeners.column.player')}</Table.Th>
                        <Table.Th w={140}>{t('listeners.column.connected')}</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {connections.map(connection => (
                        <Table.Tr key={`${connection.via} ${connection.mount ?? ''} ${connection.address} ${connection.agent ?? ''}`}>
                            <Table.Td>
                                {connection.via === 'hls' ? (
                                    <Badge size="xs" variant="light" color="gray" tt="none">
                                        {t('listeners.hls')}
                                    </Badge>
                                ) : (
                                    <Text size="xs" ff="monospace">
                                        {connection.mount}
                                    </Text>
                                )}
                            </Table.Td>
                            <Table.Td>
                                <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>
                                    {connection.address}
                                </Text>
                            </Table.Td>
                            <Table.Td style={{ maxWidth: 0 }}>
                                {connection.agent === undefined ? (
                                    <Text size="sm" c="dimmed">
                                        {t('listeners.noAgent')}
                                    </Text>
                                ) : (
                                    <Tooltip label={connection.agent} multiline maw={420} openDelay={400}>
                                        <Text size="sm" truncate>
                                            {connection.agent}
                                        </Text>
                                    </Tooltip>
                                )}
                            </Table.Td>
                            <Table.Td>
                                <Text size="sm" className="da-num">
                                    {formatDuration(connection.connectedMs)}
                                </Text>
                            </Table.Td>
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
        </Table.ScrollContainer>
    );
}
