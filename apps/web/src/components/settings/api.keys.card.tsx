import { useState } from 'react';
import { Alert, Button, Card, Code, Group, SegmentedControl, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { DateTime } from 'luxon';
import type { ApiKey, ApiKeyIssued, ApiKeyScope } from '@deadair/sdk';

import { useApiKeys, useCreateApiKey, useRevokeApiKey, useRotateApiKey } from '../../api/auth.apikeys.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ConfirmModal } from '../shared/confirm.modal';
import { CopyButton } from '../shared/copy.button';
import { ErrorAlert } from '../shared/error.alert';
import { formatDate } from '../shared/format.date';
import { notifyDone } from '../shared/notify';
import { PageSkeleton } from '../shared/page.skeleton';
import { PhoneCard } from '../shared/phone.card';
import type { StatusTone } from '../shared/status';
import { StatusLamp } from '../shared/status.lamp';
import { usePhone } from '../shared/use.phone';
import { isStepUpCancelled, StepUpDialog, useStepUpGate } from './step.up.dialog';

type Gate = ReturnType<typeof useStepUpGate>;

/** The two grants a key can be given, as the operator reads them. `manage` includes `view` on the API. */
const ACCESS_CHOICES: ReadonlyArray<{ value: ApiKeyScope; label: string }> = [
    { value: 'view', label: 'Read only' },
    { value: 'manage', label: 'Read and manage' },
];

/** How long a new key lives. Days, or never; the API has no ceiling of its own. */
const EXPIRY_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'never', label: 'Never' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
    { value: '365', label: '1 year' },
];

function accessWord(key: ApiKey): string {
    return key.scopes.includes('manage') ? 'Read and manage' : key.scopes.includes('view') ? 'Read only' : 'Nothing';
}

type KeyState = 'active' | 'expired' | 'revoked';

function keyState(key: ApiKey, now: DateTime): KeyState {
    if (key.revokedAt) return 'revoked';
    if (key.expiresAt && key.expiresAt <= now) return 'expired';
    return 'active';
}

/** Neither of the dead states is a fault: somebody chose them, or chose the date that brought one about. */
const STATE_TONES: Record<KeyState, StatusTone> = { active: 'ok', expired: 'off', revoked: 'off' };

/** The hint is the token's first characters; the ellipsis says so, so nobody pastes it as the key. */
function hintText(key: ApiKey): string {
    return `${key.hint}…`;
}

/**
 * Personal API keys: what a script or an integration uses to reach the station as this account.
 *
 * A key acts as the account with less, never more: "Read only" reaches what a listener may read,
 * "Read and manage" reaches what the account may change, and a key held by a listener account can
 * only ever read. No key can sign in, change how the account signs in, or make other keys; all of
 * that is here, and needs the person.
 *
 * The token is shown once, on the response that issued it, and held in this card's state only for as
 * long as the panel is open. Issuing and rotating are behind the same re-verify dialog as enrolling
 * a factor, because each hands out a credential that acts as the account; revoking is not, because
 * taking access away is never the change a stolen session wants.
 */
export function ApiKeysCard() {
    const keys = useApiKeys();
    const gate = useStepUpGate();
    const phone = usePhone();
    const [issued, setIssued] = useState<{ issued: ApiKeyIssued; verb: 'created' | 'rotated' }>();
    const now = DateTime.now();

    const list = keys.data?.keys ?? [];

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        API keys
                    </Title>
                    <Text size="sm" c="dimmed">
                        For a script or an integration that should reach the station as you without your password. A key never does more than this
                        account can, and it cannot sign in, change how you sign in, or make other keys.
                    </Text>
                </Stack>

                {issued ? <IssuedPanel issued={issued.issued} verb={issued.verb} onDone={() => setIssued(undefined)} /> : undefined}

                {keys.isPending ? <PageSkeleton variant="rows" count={2} /> : undefined}
                {keys.error ? (
                    <ErrorAlert title="API keys unavailable" error={keys.error} fallback="The station could not list this account's keys." />
                ) : undefined}

                {keys.data && list.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        No keys yet. Nothing outside the console can reach the station as you.
                    </Text>
                ) : undefined}

                {keys.data && list.length > 0 && phone ? (
                    <Stack gap="xxs">
                        {list.map(key => (
                            <KeyPhoneCard
                                key={key.id}
                                apiKey={key}
                                state={keyState(key, now)}
                                gate={gate}
                                onRotated={next => setIssued({ issued: next, verb: 'rotated' })}
                            />
                        ))}
                    </Stack>
                ) : undefined}

                {keys.data && list.length > 0 && !phone ? (
                    <Table.ScrollContainer minWidth={640}>
                        <Table verticalSpacing="sm" horizontalSpacing="sm" layout="fixed">
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th w="26%">Name</Table.Th>
                                    <Table.Th>Access</Table.Th>
                                    <Table.Th>Last used</Table.Th>
                                    <Table.Th>Expires</Table.Th>
                                    <Table.Th w={180} ta="right">
                                        {' '}
                                    </Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {list.map(key => (
                                    <KeyRow
                                        key={key.id}
                                        apiKey={key}
                                        state={keyState(key, now)}
                                        gate={gate}
                                        onRotated={next => setIssued({ issued: next, verb: 'rotated' })}
                                    />
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                ) : undefined}

                {keys.data ? <NewKeyForm gate={gate} onIssued={next => setIssued({ issued: next, verb: 'created' })} /> : undefined}
            </Stack>

            <StepUpDialog gate={gate} />
        </Card>
    );
}

/**
 * The one time a token is on screen. Copy it or lose it: the station keeps only a hash, and the way
 * back from a lost token is to rotate the key and update whatever held it.
 */
function IssuedPanel({ issued, verb, onDone }: { issued: ApiKeyIssued; verb: 'created' | 'rotated'; onDone: () => void }) {
    return (
        <Alert color="yellow" variant="light" title={`${issued.key.name}: ${verb === 'created' ? 'key created' : 'new token'}`}>
            <Stack gap="sm">
                <Text size="sm">
                    {verb === 'created'
                        ? 'Copy it now. The station keeps only a fingerprint of it and can never show it again.'
                        : 'The old token has stopped working. Copy this one now; it will not be shown again.'}
                </Text>
                <Group gap="xs" wrap="nowrap" align="flex-start">
                    <Code style={{ overflowWrap: 'anywhere', flex: 1 }}>{issued.token}</Code>
                    <CopyButton value={issued.token} />
                </Group>
                <Text size="xs" c="dimmed">
                    Send it as <Code>Authorization: Bearer {'<key>'}</Code>.
                </Text>
                <Group justify="flex-end">
                    <Button variant="default" size="compact-sm" onClick={onDone}>
                        Done
                    </Button>
                </Group>
            </Stack>
        </Alert>
    );
}

interface KeyProps {
    apiKey: ApiKey;
    state: KeyState;
    gate: Gate;
    onRotated: (issued: ApiKeyIssued) => void;
}

function KeyRow({ apiKey, state, gate, onRotated }: KeyProps) {
    return (
        <Table.Tr style={{ opacity: state === 'active' ? 1 : 0.6 }}>
            <Table.Td>
                <Stack gap="xxxs">
                    <Text size="sm" fw={500} truncate>
                        {apiKey.name}
                    </Text>
                    <Code w="fit-content">{hintText(apiKey)}</Code>
                </Stack>
            </Table.Td>
            <Table.Td>
                <Text size="sm">{accessWord(apiKey)}</Text>
            </Table.Td>
            <Table.Td>
                <Text size="sm" className="da-num">
                    {apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : 'Never'}
                </Text>
            </Table.Td>
            <Table.Td>
                <Stack gap="xxxs">
                    <Text size="sm" className="da-num">
                        {state === 'revoked' ? formatDate(apiKey.revokedAt) : apiKey.expiresAt ? formatDate(apiKey.expiresAt) : 'Never'}
                    </Text>
                    <StatusLamp tone={STATE_TONES[state]} label={state} />
                </Stack>
            </Table.Td>
            <Table.Td>
                <KeyActions apiKey={apiKey} state={state} gate={gate} onRotated={onRotated} />
            </Table.Td>
        </Table.Tr>
    );
}

/** One key, on a phone: the name and its state are the line you scan, the rest sits under them. */
function KeyPhoneCard({ apiKey, state, gate, onRotated }: KeyProps) {
    return (
        <PhoneCard
            opacity={state === 'active' ? 1 : 0.6}
            title={
                <Text size="sm" fw={500} truncate>
                    {apiKey.name}
                </Text>
            }
            subtitle={
                <Text size="xs" c="dimmed" truncate>
                    {`${accessWord(apiKey)} · ${apiKey.lastUsedAt ? `used ${formatDate(apiKey.lastUsedAt)}` : 'never used'}`}
                </Text>
            }
            figure={<StatusLamp tone={STATE_TONES[state]} label={state} />}
            below={
                <Group justify="space-between" mt="xs" wrap="nowrap">
                    <Code>{hintText(apiKey)}</Code>
                    <KeyActions apiKey={apiKey} state={state} gate={gate} onRotated={onRotated} />
                </Group>
            }
        />
    );
}

/**
 * Rotate and revoke, each behind a confirmation. A revoked key has neither; an expired one can only
 * be revoked, since a new token for it would be refused on its first request.
 */
function KeyActions({ apiKey, state, gate, onRotated }: KeyProps) {
    const rotate = useRotateApiKey();
    const revoke = useRevokeApiKey();
    const [confirming, setConfirming] = useState<'rotate' | 'revoke'>();
    const [failure, setFailure] = useState<unknown>();

    if (state === 'revoked') return null;

    function close(): void {
        setConfirming(undefined);
        setFailure(undefined);
    }

    async function confirmRotate(): Promise<void> {
        setFailure(undefined);
        try {
            const issued = await gate.run(() => rotate.mutateAsync({ id: apiKey.id }));
            close();
            onRotated(issued);
        } catch (caught) {
            // The re-verify dialog was closed without a code; the key is exactly as it was.
            if (isStepUpCancelled(caught)) return;
            setFailure(caught);
        }
    }

    async function confirmRevoke(): Promise<void> {
        setFailure(undefined);
        try {
            await revoke.mutateAsync({ id: apiKey.id });
            close();
            notifyDone(`${apiKey.name} revoked.`);
        } catch (caught) {
            setFailure(caught);
        }
    }

    return (
        <Group gap="xxs" justify="flex-end" wrap="nowrap">
            {state === 'active' ? (
                <Button variant="subtle" size="compact-sm" onClick={() => setConfirming('rotate')}>
                    Rotate
                </Button>
            ) : undefined}
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming('revoke')}>
                Revoke
            </Button>

            <ConfirmModal
                opened={confirming === 'rotate'}
                onClose={close}
                onConfirm={() => void confirmRotate()}
                title={`Rotate ${apiKey.name}?`}
                confirmLabel="Rotate"
                confirming={rotate.isPending}
                error={failure}
                errorTitle="Not rotated"
                errorFallback="The key still has its old token."
            >
                The current token stops working at once, and the new one is shown here once. Whatever uses this key needs the new token before its
                next request.
            </ConfirmModal>
            <ConfirmModal
                opened={confirming === 'revoke'}
                onClose={close}
                onConfirm={() => void confirmRevoke()}
                title={`Revoke ${apiKey.name}?`}
                confirmLabel="Revoke"
                confirming={revoke.isPending}
                error={failure}
                errorTitle="Not revoked"
                errorFallback="The key still works."
            >
                Every request made with this key is refused from the next one on. It stays in this list, marked revoked.
            </ConfirmModal>
        </Group>
    );
}

function NewKeyForm({ gate, onIssued }: { gate: Gate; onIssued: (issued: ApiKeyIssued) => void }) {
    const create = useCreateApiKey();
    const [name, setName] = useState('');
    const [access, setAccess] = useState<ApiKeyScope>('view');
    const [expiry, setExpiry] = useState('never');
    const [failure, setFailure] = useState<unknown>();

    async function submit(): Promise<void> {
        setFailure(undefined);
        const expiresAt = expiry === 'never' ? undefined : DateTime.now().plus({ days: Number(expiry) });
        try {
            const issued = await gate.run(() => create.mutateAsync({ name, scopes: [access], ...(expiresAt ? { expiresAt } : {}) }));
            setName('');
            setAccess('view');
            setExpiry('never');
            onIssued(issued);
        } catch (caught) {
            if (!isStepUpCancelled(caught)) setFailure(caught);
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
                    <ErrorAlert title="No key created">{apiErrorMessage(failure, 'The station could not create a key.')}</ErrorAlert>
                ) : undefined}
                <Group align="flex-end" gap="sm">
                    <TextInput
                        label="New key"
                        description="What will use it, so you can tell keys apart later"
                        placeholder="Doorbell"
                        value={name}
                        onChange={event => setName(event.currentTarget.value)}
                        maxLength={100}
                        style={{ flex: '1 1 14rem' }}
                    />
                    <Stack gap={4}>
                        <Text size="sm" fw={500}>
                            Access
                        </Text>
                        <SegmentedControl
                            aria-label="Access"
                            value={access}
                            onChange={value => setAccess(value as ApiKeyScope)}
                            data={ACCESS_CHOICES.map(choice => ({ value: choice.value, label: choice.label }))}
                        />
                    </Stack>
                    <Select
                        label="Expires"
                        value={expiry}
                        onChange={value => setExpiry(value ?? 'never')}
                        data={EXPIRY_CHOICES.map(choice => ({ value: choice.value, label: choice.label }))}
                        allowDeselect={false}
                        w={130}
                    />
                    <Button type="submit" loading={create.isPending} disabled={name.trim().length === 0}>
                        Create key
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}
