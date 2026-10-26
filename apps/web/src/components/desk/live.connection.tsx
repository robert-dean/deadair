import { useState } from 'react';
import { Anchor, Code, Group, Stack, Table, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { useLiveConnection } from '../../api/playout.queries';
import { apiErrorMessage, isForbidden } from '../../api/sdk.error';
import { CopyButton } from '../shared/copy.button';
import { ErrorAlert } from '../shared/error.alert';

/**
 * What to type into an encoder to reach the live input, one row per field, each with its own copy.
 *
 * The server is the address this console was loaded from, which is the one the operator's own machine
 * already reaches the station at; the port is the one the station's container publishes, and a host
 * that maps it to another number has to be told that number instead, which is said beside it rather
 * than guessed at. The password is hidden until asked for, because this is a desk other people walk
 * past, and copying it does not need it shown.
 */
export function LiveConnection() {
    const { t } = useTranslation('desk');
    const connection = useLiveConnection(true);
    const [shown, setShown] = useState(false);

    if (connection.isError) {
        return (
            <ErrorAlert>
                {isForbidden(connection.error) ? t('live.connection.forbidden') : apiErrorMessage(connection.error, t('live.connection.failed'))}
            </ErrorAlert>
        );
    }
    if (!connection.data)
        return (
            <Text size="sm" c="dimmed">
                {t('live.connection.loading')}
            </Text>
        );

    const { port, mount, user, password } = connection.data;
    const rows: { label: string; value: string; shown?: string }[] = [
        { label: t('live.connection.server'), value: window.location.hostname },
        { label: t('live.connection.port'), value: String(port) },
        { label: t('live.connection.mount'), value: mount },
        { label: t('live.connection.user'), value: user },
        { label: t('live.connection.password'), value: password, shown: shown ? password : '••••••••' },
    ];

    return (
        <Stack gap="xs">
            <Table withRowBorders={false} verticalSpacing={4}>
                <Table.Tbody>
                    {rows.map(row => (
                        <Table.Tr key={row.label}>
                            <Table.Td w={110}>
                                <Text size="sm" c="dimmed">
                                    {row.label}
                                </Text>
                            </Table.Td>
                            <Table.Td>
                                <Group gap="xs" wrap="nowrap">
                                    <Code style={{ overflowWrap: 'anywhere' }}>{row.shown ?? row.value}</Code>
                                    <CopyButton value={row.value} />
                                    {row.shown === undefined ? undefined : (
                                        <Anchor component="button" type="button" size="xs" onClick={() => setShown(open => !open)}>
                                            {shown ? t('live.connection.hide') : t('live.connection.show')}
                                        </Anchor>
                                    )}
                                </Group>
                            </Table.Td>
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
            <Text size="xs" c="dimmed">
                {t('live.connection.portNote')}
            </Text>
            <Text size="xs" c="dimmed">
                {t('live.connection.encoders')}
            </Text>
        </Stack>
    );
}
