import { useState } from 'react';
import { Button, Group, SegmentedControl, Stack, Table, Text, TextInput } from '@mantine/core';
import type { ListenerRequest, RequestStatus } from '@deadair/sdk';

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

/** A state in the station's words, and the tone it is drawn in. */
const STATUS: Record<RequestStatus, { label: string; tone: StatusTone }> = {
    waiting: { label: 'Needs a decision', tone: 'fault' },
    pending: { label: 'On its way', tone: 'standby' },
    queued: { label: 'In the running order', tone: 'ok' },
    aired: { label: 'Played', tone: 'off' },
    declined: { label: 'Declined', tone: 'off' },
    expired: { label: 'Lapsed', tone: 'off' },
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
    const requests = useRequests();
    const [filter, setFilter] = useState<Filter>('open');

    if (sdkError(requests.error)?.status === 403) {
        return <EmptyState>Listener requests are for the station’s operators to decide on.</EmptyState>;
    }
    if (requests.isPending) return <PageSkeleton variant="rows" count={4} />;

    const all = requests.data?.requests ?? [];
    const shown = filter === 'open' ? all.filter(request => OPEN.includes(request.status)) : all;

    return (
        <Stack gap="md">
            {requests.error ? (
                <ErrorAlert title="Requests unavailable" error={requests.error} fallback="The station could not list its requests." />
            ) : undefined}
            <Group justify="space-between">
                <Text size="sm" c="dimmed">
                    Records listeners asked for, from an app or a chat. Who may ask and how often is under Settings, Rotation.
                </Text>
                <SegmentedControl
                    size="xs"
                    value={filter}
                    onChange={value => setFilter(value as Filter)}
                    data={[
                        { value: 'open', label: 'Open' },
                        { value: 'all', label: 'Recent' },
                    ]}
                />
            </Group>
            {shown.length === 0 ? (
                <EmptyState>{filter === 'open' ? 'Nobody is waiting on a request.' : 'Nobody has asked for anything lately.'}</EmptyState>
            ) : (
                <Table>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Record</Table.Th>
                            <Table.Th>Asked by</Table.Th>
                            <Table.Th>State</Table.Th>
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
    const grant = useGrantRequest();
    const decline = useDeclineRequest();
    const [declining, setDeclining] = useState(false);
    const [reason, setReason] = useState('');
    const status = STATUS[request.status];
    const record = `${request.title} by ${request.artist}`;

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
                        {`${request.dedicateTo === undefined ? 'Dedicated' : `For ${request.dedicateTo}`}${request.message === undefined ? '' : `: “${request.message}”`}`}
                    </Text>
                ) : undefined}
            </Table.Td>
            <Table.Td>
                <Text size="sm">{request.requesterName}</Text>
                <Text size="xs" c="dimmed">{`${request.source === 'chat' ? 'From a chat' : 'From an app'}, ${formatDate(request.createdAt)}`}</Text>
            </Table.Td>
            <Table.Td>
                <StatusLamp tone={status.tone} label={status.label} />
                {request.reason ? (
                    <Text size="xs" c="dimmed">
                        {request.reason}
                    </Text>
                ) : undefined}
                {grant.error ? <ErrorAlert title="Not granted" error={grant.error} fallback="The request is as it was." /> : undefined}
            </Table.Td>
            <Table.Td>
                <Group gap="xs" justify="flex-end" wrap="nowrap">
                    {request.status === 'waiting' ? (
                        <Button
                            size="compact-sm"
                            variant="light"
                            loading={grant.isPending}
                            onClick={() => void grant.mutateAsync(request.id).then(() => notifyDone(`${record} is on its way.`))}
                        >
                            Grant
                        </Button>
                    ) : undefined}
                    {request.status === 'waiting' || request.status === 'pending' ? (
                        <Button size="compact-sm" variant="subtle" color="red" onClick={() => setDeclining(true)}>
                            Decline
                        </Button>
                    ) : undefined}
                </Group>
                <ConfirmModal
                    opened={declining}
                    onClose={() => setDeclining(false)}
                    onConfirm={() =>
                        void decline.mutateAsync({ id: request.id, reason }).then(() => {
                            setDeclining(false);
                            notifyDone(`${record} declined.`);
                        })
                    }
                    title={`Decline ${record}?`}
                    confirmLabel="Decline"
                    confirming={decline.isPending}
                    error={decline.error}
                    errorTitle="Not declined"
                    errorFallback="The request is as it was."
                >
                    <Stack gap="xs">
                        <Text size="sm">{`${request.requesterName} is told it will not be played${request.source === 'chat' ? ', in the chat they asked from' : ''}.`}</Text>
                        <TextInput
                            label="What to tell them"
                            placeholder="Not tonight."
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
