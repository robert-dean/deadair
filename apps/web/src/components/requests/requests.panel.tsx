import { useState } from 'react';
import { Button, Group, SegmentedControl, Stack, Table, Text, TextInput } from '@mantine/core';
import type { ListenerRequest, RequestStatus } from '@deadair/sdk';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useDeclineRequest, useGrantRequest, useRequests } from '../../api/requests.queries';
import { sdkError } from '../../api/sdk.error';
import { ConfirmModal } from '../shared/confirm.modal';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { formatDate } from '../shared/format.date';
import { notifyDone } from '../shared/notify';
import { PageSkeleton } from '../shared/page.skeleton';
import type { StatusTone } from '../shared/status';
import { StatusLamp } from '../shared/status.lamp';

/** The tone a state is drawn in. Its words are `requests:status.<state>`. */
const STATUS_TONE: Record<RequestStatus, StatusTone> = {
    waiting: 'fault',
    pending: 'standby',
    queued: 'ok',
    aired: 'off',
    declined: 'off',
    expired: 'off',
};

const OPEN: readonly RequestStatus[] = ['waiting', 'pending', 'queued'];

type Filter = 'open' | 'all';

/**
 * What listeners have asked for, and the operator's decision on it.
 *
 * A tab on Programme because a request is a record the station will play a few records from now,
 * which is what that destination answers. Open requests first, since those are the ones with a
 * decision still to make; everything recent a click away. `waiting` is drawn in the attention tone
 * because it is the one state that is waiting on the person looking at this page.
 *
 * Decisions only: a request already in the running order is taken out from the Desk, where the
 * order is, and the station's own rules (the cooldown, one per person, the cap) are Settings,
 * Rotation. An operator's list: somebody without the role sees a sentence rather than an error.
 */
export function RequestsPanel() {
    const { t } = useTranslation('requests');
    const requests = useRequests();
    const [filter, setFilter] = useState<Filter>('open');

    if (sdkError(requests.error)?.status === 403) {
        return <EmptyState>{t('forbidden')}</EmptyState>;
    }
    if (requests.isPending) return <PageSkeleton variant="rows" count={4} />;

    const all = requests.data?.requests ?? [];
    const shown = filter === 'open' ? all.filter(request => OPEN.includes(request.status)) : all;

    return (
        <Stack gap="md">
            {requests.error ? <ErrorAlert title={t('error.title')} error={requests.error} fallback={t('error.fallback')} /> : undefined}
            <Group justify="space-between">
                <Text size="sm" c="dimmed">
                    {t('description')}
                </Text>
                <SegmentedControl
                    size="xs"
                    value={filter}
                    onChange={value => setFilter(value as Filter)}
                    data={[
                        { value: 'open', label: t('filter.open') },
                        { value: 'all', label: t('filter.all') },
                    ]}
                />
            </Group>
            {shown.length === 0 ? (
                <EmptyState>{filter === 'open' ? t('empty.open') : t('empty.all')}</EmptyState>
            ) : (
                <Table>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>{t('column.record')}</Table.Th>
                            <Table.Th>{t('column.askedBy')}</Table.Th>
                            <Table.Th>{t('column.state')}</Table.Th>
                            <Table.Th />
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {shown.map(request => (
                            <RequestRow key={request.id} request={request} />
                        ))}
                    </Table.Tbody>
                </Table>
            )}
        </Stack>
    );
}

function RequestRow({ request }: { request: ListenerRequest }) {
    const { t } = useTranslation('requests');
    const grant = useGrantRequest();
    const decline = useDeclineRequest();
    const [declining, setDeclining] = useState(false);
    const [reason, setReason] = useState('');
    const record = t('row.record', { title: request.title, artist: request.artist });

    return (
        <Table.Tr>
            <Table.Td>
                <Text size="sm">{request.title}</Text>
                <Text size="xs" c="dimmed">
                    {request.artist}
                </Text>
                {request.dedicateTo !== undefined || request.message !== undefined ? (
                    // The listener's own words, shown as theirs so an operator can decide on them before
                    // the presenter passes them on. Never reached by anything the station says itself.
                    <Text size="xs" fs="italic">
                        {dedication(request, t)}
                    </Text>
                ) : undefined}
            </Table.Td>
            <Table.Td>
                <Text size="sm">{request.requesterName}</Text>
                <Text size="xs" c="dimmed">
                    {t(request.source === 'chat' ? 'row.fromChat' : 'row.fromApp', { date: formatDate(request.createdAt) })}
                </Text>
            </Table.Td>
            <Table.Td>
                <StatusLamp tone={STATUS_TONE[request.status]} label={t(`status.${request.status}`)} />
                {request.reason ? (
                    <Text size="xs" c="dimmed">
                        {request.reason}
                    </Text>
                ) : undefined}
                {grant.error ? <ErrorAlert title={t('grant.error')} error={grant.error} fallback={t('unchanged')} /> : undefined}
            </Table.Td>
            <Table.Td>
                <Group gap="xs" justify="flex-end" wrap="nowrap">
                    {request.status === 'waiting' ? (
                        <Button
                            size="compact-sm"
                            variant="light"
                            loading={grant.isPending}
                            onClick={() => void grant.mutateAsync(request.id).then(() => notifyDone(t('grant.done', { record })))}
                        >
                            {t('grant.action')}
                        </Button>
                    ) : undefined}
                    {request.status === 'waiting' || request.status === 'pending' ? (
                        <Button size="compact-sm" variant="subtle" color="red" onClick={() => setDeclining(true)}>
                            {t('decline.action')}
                        </Button>
                    ) : undefined}
                </Group>
                <ConfirmModal
                    opened={declining}
                    onClose={() => setDeclining(false)}
                    onConfirm={() =>
                        void decline.mutateAsync({ id: request.id, reason }).then(() => {
                            setDeclining(false);
                            notifyDone(t('decline.done', { record }));
                        })
                    }
                    title={t('decline.title', { record })}
                    confirmLabel={t('decline.action')}
                    confirming={decline.isPending}
                    error={decline.error}
                    errorTitle={t('decline.error')}
                    errorFallback={t('unchanged')}
                >
                    <Stack gap="xs">
                        <Text size="sm">{t(request.source === 'chat' ? 'decline.toldInChat' : 'decline.told', { name: request.requesterName })}</Text>
                        <TextInput
                            label={t('decline.reason.label')}
                            placeholder={t('decline.reason.placeholder')}
                            value={reason}
                            onChange={event => setReason(event.currentTarget.value)}
                            maxLength={400}
                        />
                    </Stack>
                </ConfirmModal>
            </Table.Td>
        </Table.Tr>
    );
}

/** The listener's dedication and message, in one sentence however much of it they filled in. */
function dedication(request: ListenerRequest, t: TFunction<'requests'>): string {
    if (request.dedicateTo === undefined) {
        return request.message === undefined ? t('dedication.plain') : t('dedication.message', { message: request.message });
    }
    return request.message === undefined
        ? t('dedication.to', { name: request.dedicateTo })
        : t('dedication.toWithMessage', { name: request.dedicateTo, message: request.message });
}
