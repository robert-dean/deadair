import { useState } from 'react';
import { Alert, Button, Card, Code, Drawer, Group, Modal, MultiSelect, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core';
import { Trans, useTranslation } from 'react-i18next';
import type { EventDelivery, EventDestination, EventTestResult } from '@deadair/sdk';

import {
    useCreateEventDestination,
    useDeleteEventDestination,
    useEventDeliveries,
    useEventDestinations,
    useEventTypes,
    useRotateEventDestinationSecret,
    useTestEventDestination,
    useUpdateEventDestination,
} from '../../api/events.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ConfirmModal } from '../shared/confirm.modal';
import { CopyButton } from '../shared/copy.button';
import { ErrorAlert } from '../shared/error.alert';
import { formatMomentStamp } from '../shared/feed.moment';
import { notifyDone, notifySaved } from '../shared/notify';
import { PageSkeleton } from '../shared/page.skeleton';
import { PhoneCard } from '../shared/phone.card';
import type { StatusTone } from '../shared/status';
import { StatusLamp } from '../shared/status.lamp';
import { usePhone } from '../shared/use.phone';

/** How a destination is doing, as one lamp. */
type DestinationState = 'switchedOff' | 'off' | 'failing' | 'delivering' | 'idle';

function destinationState(destination: EventDestination): DestinationState {
    if (destination.disabledReason === 'failing') return 'switchedOff';
    if (!destination.enabled) return 'off';
    if (destination.consecutiveFailures > 0) return 'failing';
    return destination.lastDeliveredAt ? 'delivering' : 'idle';
}

/**
 * Only the two that need a person are faults. One the operator turned off is off, and one that has
 * sent nothing yet is waiting for the station to do something worth saying, not broken.
 */
const STATE_TONES: Record<DestinationState, StatusTone> = { switchedOff: 'fault', off: 'off', failing: 'fault', delivering: 'ok', idle: 'standby' };

const OUTCOME_TONES: Record<EventDelivery['outcome'], StatusTone> = { delivered: 'ok', failed: 'fault', dropped: 'off' };

/** A secret just minted, and which way: a new destination, or a new secret for an old one. */
interface Minted {
    name: string;
    secret: string;
    verb: 'created' | 'rotated';
}

/**
 * Event destinations: an operator's own servers (a home automation hub, a workflow tool) the station
 * sends a signed POST to as things happen on air.
 *
 * The secret is shown once, on the answer that minted it, and held in this card's state only while
 * the panel is open, on the API keys card's rule. Unlike a key it is not behind a re-verify: it
 * signs what the station says and grants nobody anything.
 */
export function EventDestinationsCard() {
    const { t } = useTranslation('settings');
    const destinations = useEventDestinations();
    const phone = usePhone();
    const [minted, setMinted] = useState<Minted>();
    const [tested, setTested] = useState<{ name: string; result: EventTestResult }>();
    const [editing, setEditing] = useState<EventDestination>();
    const [logOf, setLogOf] = useState<EventDestination>();

    const list = destinations.data?.destinations ?? [];
    const actions = {
        onTested: (destination: EventDestination, result: EventTestResult) => setTested({ name: destination.name, result }),
        onRotated: (destination: EventDestination, secret: string) => setMinted({ name: destination.name, secret, verb: 'rotated' }),
        onEdit: setEditing,
        onLog: setLogOf,
    };

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {t('eventDestinations.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('eventDestinations.intro')}
                    </Text>
                </Stack>

                {minted ? <SecretPanel minted={minted} onDone={() => setMinted(undefined)} /> : undefined}
                {tested ? <TestPanel name={tested.name} result={tested.result} onDone={() => setTested(undefined)} /> : undefined}

                {destinations.isPending ? <PageSkeleton variant="rows" count={2} /> : undefined}
                {destinations.error ? (
                    <ErrorAlert
                        title={t('eventDestinations.unavailable.title')}
                        error={destinations.error}
                        fallback={t('eventDestinations.unavailable.fallback')}
                    />
                ) : undefined}

                {destinations.data && list.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {t('eventDestinations.empty')}
                    </Text>
                ) : undefined}

                {destinations.data && list.length > 0 && phone ? (
                    <Stack gap="xxs">
                        {list.map(destination => (
                            <DestinationPhoneCard key={destination.id} destination={destination} {...actions} />
                        ))}
                    </Stack>
                ) : undefined}

                {destinations.data && list.length > 0 && !phone ? (
                    <Table.ScrollContainer minWidth={800}>
                        <Table verticalSpacing="sm" horizontalSpacing="sm" layout="fixed">
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th w="34%">{t('eventDestinations.column.destination')}</Table.Th>
                                    <Table.Th>{t('eventDestinations.column.events')}</Table.Th>
                                    <Table.Th>{t('eventDestinations.column.state')}</Table.Th>
                                    <Table.Th w={380} ta="right">
                                        {' '}
                                    </Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {list.map(destination => (
                                    <DestinationRow key={destination.id} destination={destination} {...actions} />
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                ) : undefined}

                {destinations.data ? <NewDestinationForm onCreated={(name, secret) => setMinted({ name, secret, verb: 'created' })} /> : undefined}
            </Stack>

            {editing ? <EditDestinationModal destination={editing} onClose={() => setEditing(undefined)} /> : undefined}
            <DeliveriesDrawer destination={logOf} onClose={() => setLogOf(undefined)} />
        </Card>
    );
}

/** The one time a secret is on screen, and what a receiver does with it. */
function SecretPanel({ minted, onDone }: { minted: Minted; onDone: () => void }) {
    const { t } = useTranslation('settings');
    return (
        <Alert color="yellow" variant="light" title={t(`eventDestinations.secret.title.${minted.verb}`, { name: minted.name })}>
            <Stack gap="sm">
                <Text size="sm">{t('eventDestinations.secret.body')}</Text>
                <Group gap="xs" wrap="nowrap" align="flex-start">
                    <Code style={{ overflowWrap: 'anywhere', flex: 1 }}>{minted.secret}</Code>
                    <CopyButton value={minted.secret} />
                </Group>
                <Text size="xs" c="dimmed">
                    <Trans t={t} i18nKey="eventDestinations.secret.how" components={{ code: <Code /> }} />
                </Text>
                <Group justify="flex-end">
                    <Button variant="default" size="compact-sm" onClick={onDone}>
                        {t('eventDestinations.secret.done')}
                    </Button>
                </Group>
            </Stack>
        </Alert>
    );
}

/** What a test delivery came to, in the station's words. */
function TestPanel({ name, result, onDone }: { name: string; result: EventTestResult; onDone: () => void }) {
    const { t } = useTranslation('settings');
    const answered =
        result.httpStatus === undefined ? t('eventDestinations.test.noAnswer') : t('eventDestinations.test.answered', { status: result.httpStatus });
    return (
        <Alert
            color={result.delivered ? 'teal' : 'yellow'}
            variant="light"
            withCloseButton
            onClose={onDone}
            title={t(result.delivered ? 'eventDestinations.test.delivered' : 'eventDestinations.test.failed', { name })}
        >
            <Text size="sm">
                {t('eventDestinations.test.detail', { answered, ms: result.durationMs })}
                {result.error ? ` ${result.error}` : ''}
            </Text>
        </Alert>
    );
}

interface DestinationProps {
    destination: EventDestination;
    onTested: (destination: EventDestination, result: EventTestResult) => void;
    onRotated: (destination: EventDestination, secret: string) => void;
    onEdit: (destination: EventDestination) => void;
    onLog: (destination: EventDestination) => void;
}

/** "Every event", or the types it asked for. */
function EventsSummary({ events }: { events: string[] }) {
    const { t } = useTranslation('settings');
    if (events.length === 0) return <Text size="sm">{t('eventDestinations.everyEvent')}</Text>;
    return (
        <Text size="sm" truncate>
            {events.join(', ')}
        </Text>
    );
}

/** The lamp, and the sentence under it that says why when something is wrong. */
function DestinationStatus({ destination }: { destination: EventDestination }) {
    const { t } = useTranslation('settings');
    const state = destinationState(destination);
    return (
        <Stack gap="xxxs">
            <StatusLamp tone={STATE_TONES[state]} label={t(`eventDestinations.state.${state}`, { count: destination.consecutiveFailures })} />
            {state === 'failing' || state === 'switchedOff' ? (
                <Text size="xs" c="dimmed" lineClamp={2}>
                    {destination.lastFailure}
                </Text>
            ) : undefined}
            {state === 'delivering' ? (
                <Text size="xs" c="dimmed" className="da-num">
                    {t('eventDestinations.lastDelivered', { when: formatMomentStamp(destination.lastDeliveredAt) })}
                </Text>
            ) : undefined}
        </Stack>
    );
}

function DestinationRow(props: DestinationProps) {
    const { destination } = props;
    return (
        <Table.Tr style={{ opacity: destination.enabled ? 1 : 0.6 }}>
            <Table.Td>
                <Stack gap="xxxs">
                    <Text size="sm" fw={500} truncate>
                        {destination.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                        {destination.url}
                    </Text>
                </Stack>
            </Table.Td>
            <Table.Td>
                <EventsSummary events={destination.events} />
            </Table.Td>
            <Table.Td>
                <DestinationStatus destination={destination} />
            </Table.Td>
            <Table.Td>
                <DestinationActions {...props} />
            </Table.Td>
        </Table.Tr>
    );
}

/** One destination, on a phone: its name and lamp are the line you scan, the rest sits under them. */
function DestinationPhoneCard(props: DestinationProps) {
    const { destination } = props;
    const state = destinationState(destination);
    const { t } = useTranslation('settings');
    return (
        <PhoneCard
            opacity={destination.enabled ? 1 : 0.6}
            title={
                <Text size="sm" fw={500} truncate>
                    {destination.name}
                </Text>
            }
            subtitle={
                <Text size="xs" c="dimmed" truncate>
                    {destination.url}
                </Text>
            }
            figure={
                <StatusLamp tone={STATE_TONES[state]} label={t(`eventDestinations.state.${state}`, { count: destination.consecutiveFailures })} />
            }
            below={
                <Stack gap="xs" mt="xs">
                    <EventsSummary events={destination.events} />
                    <DestinationActions {...props} />
                </Stack>
            }
        />
    );
}

/** Send a test, read the log, edit; and a new secret or removal, each behind a confirmation. */
function DestinationActions({ destination, onTested, onRotated, onEdit, onLog }: DestinationProps) {
    const { t } = useTranslation('settings');
    const test = useTestEventDestination();
    const rotate = useRotateEventDestinationSecret();
    const remove = useDeleteEventDestination();
    const [confirming, setConfirming] = useState<'rotate' | 'delete'>();
    const [failure, setFailure] = useState<unknown>();

    function close(): void {
        setConfirming(undefined);
        setFailure(undefined);
    }

    async function sendTest(): Promise<void> {
        try {
            onTested(destination, await test.mutateAsync({ id: destination.id }));
        } catch (caught) {
            onTested(destination, { delivered: false, durationMs: 0, error: apiErrorMessage(caught, t('eventDestinations.test.errorFallback')) });
        }
    }

    async function confirmRotate(): Promise<void> {
        setFailure(undefined);
        try {
            const { secret } = await rotate.mutateAsync({ id: destination.id });
            close();
            onRotated(destination, secret);
        } catch (caught) {
            setFailure(caught);
        }
    }

    async function confirmDelete(): Promise<void> {
        setFailure(undefined);
        try {
            await remove.mutateAsync({ id: destination.id });
            close();
            notifyDone(t('eventDestinations.delete.done', { name: destination.name }));
        } catch (caught) {
            setFailure(caught);
        }
    }

    return (
        <Group gap="xxs" justify="flex-end" wrap="wrap">
            <Button variant="light" size="compact-sm" loading={test.isPending} onClick={() => void sendTest()}>
                {t('eventDestinations.test.action')}
            </Button>
            <Button variant="subtle" size="compact-sm" onClick={() => onLog(destination)}>
                {t('eventDestinations.log.action')}
            </Button>
            <Button variant="subtle" size="compact-sm" onClick={() => onEdit(destination)}>
                {t('eventDestinations.edit.action')}
            </Button>
            <Button variant="subtle" size="compact-sm" onClick={() => setConfirming('rotate')}>
                {t('eventDestinations.rotate.action')}
            </Button>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming('delete')}>
                {t('eventDestinations.delete.action')}
            </Button>

            <ConfirmModal
                opened={confirming === 'rotate'}
                onClose={close}
                onConfirm={() => void confirmRotate()}
                title={t('eventDestinations.rotate.title', { name: destination.name })}
                confirmLabel={t('eventDestinations.rotate.action')}
                confirming={rotate.isPending}
                error={failure}
                errorTitle={t('eventDestinations.rotate.errorTitle')}
                errorFallback={t('eventDestinations.rotate.errorFallback')}
            >
                {t('eventDestinations.rotate.body')}
            </ConfirmModal>
            <ConfirmModal
                opened={confirming === 'delete'}
                onClose={close}
                onConfirm={() => void confirmDelete()}
                title={t('eventDestinations.delete.title', { name: destination.name })}
                confirmLabel={t('eventDestinations.delete.action')}
                confirming={remove.isPending}
                error={failure}
                errorTitle={t('eventDestinations.delete.errorTitle')}
                errorFallback={t('eventDestinations.delete.errorFallback')}
            >
                {t('eventDestinations.delete.body')}
            </ConfirmModal>
        </Group>
    );
}

/** The event types a destination may ask for, from the station itself, as choices. */
function useEventChoices(): { value: string; label: string }[] {
    const types = useEventTypes();
    return (types.data?.types ?? []).filter(type => type.subscribable).map(type => ({ value: type.type, label: type.type }));
}

/** Which events to send. Nothing chosen means every type, including any the station adds later. */
function EventsPicker({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
    const { t } = useTranslation('settings');
    const choices = useEventChoices();
    return (
        <MultiSelect
            label={t('eventDestinations.form.events.label')}
            description={t('eventDestinations.form.events.description')}
            placeholder={value.length === 0 ? t('eventDestinations.everyEvent') : undefined}
            data={choices}
            value={value}
            onChange={onChange}
            clearable
            searchable
        />
    );
}

function NewDestinationForm({ onCreated }: { onCreated: (name: string, secret: string) => void }) {
    const { t } = useTranslation('settings');
    const create = useCreateEventDestination();
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [events, setEvents] = useState<string[]>([]);
    const [failure, setFailure] = useState<unknown>();

    async function submit(): Promise<void> {
        setFailure(undefined);
        try {
            const created = await create.mutateAsync({ name: name.trim(), url: url.trim(), events });
            setName('');
            setUrl('');
            setEvents([]);
            onCreated(created.name, created.secret);
        } catch (caught) {
            setFailure(caught);
        }
    }

    return (
        <form
            onSubmit={event => {
                event.preventDefault();
                void submit();
            }}
        >
            <Stack gap="sm">
                {failure ? (
                    <ErrorAlert title={t('eventDestinations.create.errorTitle')}>
                        {apiErrorMessage(failure, t('eventDestinations.create.errorFallback'))}
                    </ErrorAlert>
                ) : undefined}
                <Group align="flex-end" gap="sm">
                    <TextInput
                        label={t('eventDestinations.form.name.label')}
                        placeholder={t('eventDestinations.form.name.placeholder')}
                        value={name}
                        onChange={event => setName(event.currentTarget.value)}
                        maxLength={200}
                        style={{ flex: '1 1 12rem' }}
                    />
                    <TextInput
                        label={t('eventDestinations.form.url.label')}
                        placeholder={t('eventDestinations.form.url.placeholder')}
                        value={url}
                        onChange={event => setUrl(event.currentTarget.value)}
                        maxLength={2000}
                        style={{ flex: '2 1 18rem' }}
                    />
                </Group>
                <EventsPicker value={events} onChange={setEvents} />
                <Group justify="flex-end">
                    <Button type="submit" loading={create.isPending} disabled={name.trim().length === 0 || url.trim().length === 0}>
                        {t('eventDestinations.create.action')}
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}

/** Name, address, whether it is on, and what it is sent. Turning it back on also clears a switch-off. */
function EditDestinationModal({ destination, onClose }: { destination: EventDestination; onClose: () => void }) {
    const { t } = useTranslation('settings');
    const update = useUpdateEventDestination();
    const [name, setName] = useState(destination.name);
    const [url, setUrl] = useState(destination.url);
    const [enabled, setEnabled] = useState(destination.enabled);
    const [events, setEvents] = useState(destination.events);
    const [failure, setFailure] = useState<unknown>();

    async function save(): Promise<void> {
        setFailure(undefined);
        try {
            await update.mutateAsync({ id: destination.id, changes: { name: name.trim(), url: url.trim(), enabled, events } });
            notifySaved(destination.name);
            onClose();
        } catch (caught) {
            setFailure(caught);
        }
    }

    return (
        <Modal opened onClose={onClose} title={t('eventDestinations.edit.title', { name: destination.name })} size="lg">
            <form
                onSubmit={event => {
                    event.preventDefault();
                    void save();
                }}
            >
                <Stack gap="sm">
                    {failure ? (
                        <ErrorAlert title={t('eventDestinations.edit.errorTitle')}>
                            {apiErrorMessage(failure, t('eventDestinations.edit.errorFallback'))}
                        </ErrorAlert>
                    ) : undefined}
                    {destination.disabledReason === 'failing' ? (
                        <Alert color="yellow" variant="light">
                            {t('eventDestinations.edit.switchedOff', { count: destination.consecutiveFailures })}
                        </Alert>
                    ) : undefined}
                    <TextInput
                        label={t('eventDestinations.form.name.label')}
                        value={name}
                        onChange={event => setName(event.currentTarget.value)}
                        maxLength={200}
                    />
                    <TextInput
                        label={t('eventDestinations.form.url.label')}
                        value={url}
                        onChange={event => setUrl(event.currentTarget.value)}
                        maxLength={2000}
                    />
                    <Switch
                        label={t('eventDestinations.form.enabled')}
                        checked={enabled}
                        onChange={event => setEnabled(event.currentTarget.checked)}
                    />
                    <EventsPicker value={events} onChange={setEvents} />
                    <Group justify="flex-end" gap="xs">
                        <Button variant="default" onClick={onClose}>
                            {t('eventDestinations.edit.cancel')}
                        </Button>
                        <Button type="submit" loading={update.isPending} disabled={name.trim().length === 0 || url.trim().length === 0}>
                            {t('eventDestinations.edit.save')}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Modal>
    );
}

/** A destination's latest attempts, newest first, test deliveries among them. */
function DeliveriesDrawer({ destination, onClose }: { destination: EventDestination | undefined; onClose: () => void }) {
    const { t } = useTranslation('settings');
    const phone = usePhone();
    const deliveries = useEventDeliveries(destination?.id);
    const list = deliveries.data?.deliveries ?? [];

    return (
        <Drawer
            opened={destination !== undefined}
            onClose={onClose}
            position="right"
            size={phone ? '100%' : 'lg'}
            title={destination ? t('eventDestinations.log.title', { name: destination.name }) : undefined}
        >
            <Stack gap="sm">
                <Text size="sm" c="dimmed">
                    {t('eventDestinations.log.intro')}
                </Text>
                {deliveries.isPending && destination ? <PageSkeleton variant="rows" count={3} /> : undefined}
                {deliveries.error ? (
                    <ErrorAlert
                        title={t('eventDestinations.log.unavailable')}
                        error={deliveries.error}
                        fallback={t('eventDestinations.log.unavailable')}
                    />
                ) : undefined}
                {deliveries.data && list.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {t('eventDestinations.log.empty')}
                    </Text>
                ) : undefined}
                {list.map(delivery => (
                    <Stack key={delivery.id} gap="xxxs">
                        <Group justify="space-between" wrap="nowrap">
                            <Group gap="xs" wrap="nowrap">
                                <StatusLamp tone={OUTCOME_TONES[delivery.outcome]} label={t(`eventDestinations.log.outcome.${delivery.outcome}`)} />
                                <Code>{delivery.eventType}</Code>
                            </Group>
                            <Text size="xs" c="dimmed" className="da-num">
                                {formatMomentStamp(delivery.createdAt)}
                            </Text>
                        </Group>
                        <Text size="xs" c="dimmed" className="da-num">
                            {t('eventDestinations.log.detail', {
                                attempt: delivery.attempt,
                                answered:
                                    delivery.httpStatus === undefined
                                        ? t('eventDestinations.test.noAnswer')
                                        : t('eventDestinations.test.answered', { status: delivery.httpStatus }),
                                ms: delivery.durationMs,
                            })}
                        </Text>
                        {delivery.error ? <Text size="xs">{delivery.error}</Text> : undefined}
                    </Stack>
                ))}
            </Stack>
        </Drawer>
    );
}
