import { useState } from 'react';
import { Alert, Button, Card, Code, Group, SegmentedControl, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { DateTime } from 'luxon';
import { Trans, useTranslation } from 'react-i18next';
import type { ApiKey, ApiKeyIssued, ApiKeyScope } from '@deadair/sdk';

import { useApiKeys, useCreateApiKey, useRevokeApiKey, useRotateApiKey } from '../../api/auth.apikeys.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ConfirmModal } from '../shared/confirm.modal';
import { CopyButton } from '../shared/copy.button';
import { ACCESS_CHOICES, accessWord } from '../shared/access.words';
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

/** How long a new key lives. Days, or never; the API has no ceiling of its own. */
const EXPIRY_CHOICES = ['never', '30', '90', '365'] as const;

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
    const { t } = useTranslation('settings');
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
                        {t('apiKeys.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('apiKeys.intro')}
                    </Text>
                </Stack>

                {issued ? <IssuedPanel issued={issued.issued} verb={issued.verb} onDone={() => setIssued(undefined)} /> : undefined}

                {keys.isPending ? <PageSkeleton variant="rows" count={2} /> : undefined}
                {keys.error ? (
                    <ErrorAlert title={t('apiKeys.unavailable.title')} error={keys.error} fallback={t('apiKeys.unavailable.fallback')} />
                ) : undefined}

                {keys.data && list.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {t('apiKeys.empty')}
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
                                    <Table.Th w="26%">{t('apiKeys.column.name')}</Table.Th>
                                    <Table.Th>{t('apiKeys.column.access')}</Table.Th>
                                    <Table.Th>{t('apiKeys.column.lastUsed')}</Table.Th>
                                    <Table.Th>{t('apiKeys.column.expires')}</Table.Th>
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
    const { t } = useTranslation('settings');
    return (
        <Alert color="yellow" variant="light" title={t(`apiKeys.issued.title.${verb}`, { name: issued.key.name })}>
            <Stack gap="sm">
                <Text size="sm">{t(`apiKeys.issued.body.${verb}`)}</Text>
                <Group gap="xs" wrap="nowrap" align="flex-start">
                    <Code style={{ overflowWrap: 'anywhere', flex: 1 }}>{issued.token}</Code>
                    <CopyButton value={issued.token} />
                </Group>
                <Text size="xs" c="dimmed">
                    <Trans t={t} i18nKey="apiKeys.issued.sendAs" components={{ code: <Code /> }} />
                </Text>
                <Group justify="flex-end">
                    <Button variant="default" size="compact-sm" onClick={onDone}>
                        {t('apiKeys.issued.done')}
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
    const { t } = useTranslation('settings');
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
                <Text size="sm">{accessWord(apiKey.scopes)}</Text>
            </Table.Td>
            <Table.Td>
                <Text size="sm" className="da-num">
                    {apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : t('apiKeys.never')}
                </Text>
            </Table.Td>
            <Table.Td>
                <Stack gap="xxxs">
                    <Text size="sm" className="da-num">
                        {state === 'revoked' ? formatDate(apiKey.revokedAt) : apiKey.expiresAt ? formatDate(apiKey.expiresAt) : t('apiKeys.never')}
                    </Text>
                    <StatusLamp tone={STATE_TONES[state]} label={t(`apiKeys.state.${state}`)} />
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
    const { t } = useTranslation('settings');
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
                    {apiKey.lastUsedAt
                        ? t('apiKeys.phone.used', { access: accessWord(apiKey.scopes), date: formatDate(apiKey.lastUsedAt) })
                        : t('apiKeys.phone.neverUsed', { access: accessWord(apiKey.scopes) })}
                </Text>
            }
            figure={<StatusLamp tone={STATE_TONES[state]} label={t(`apiKeys.state.${state}`)} />}
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
    const { t } = useTranslation('settings');
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
            notifyDone(t('apiKeys.revoke.done', { name: apiKey.name }));
        } catch (caught) {
            setFailure(caught);
        }
    }

    return (
        <Group gap="xxs" justify="flex-end" wrap="nowrap">
            {state === 'active' ? (
                <Button variant="subtle" size="compact-sm" onClick={() => setConfirming('rotate')}>
                    {t('apiKeys.rotate.action')}
                </Button>
            ) : undefined}
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming('revoke')}>
                {t('apiKeys.revoke.action')}
            </Button>

            <ConfirmModal
                opened={confirming === 'rotate'}
                onClose={close}
                onConfirm={() => void confirmRotate()}
                title={t('apiKeys.rotate.title', { name: apiKey.name })}
                confirmLabel={t('apiKeys.rotate.action')}
                confirming={rotate.isPending}
                error={failure}
                errorTitle={t('apiKeys.rotate.errorTitle')}
                errorFallback={t('apiKeys.rotate.errorFallback')}
            >
                {t('apiKeys.rotate.body')}
            </ConfirmModal>
            <ConfirmModal
                opened={confirming === 'revoke'}
                onClose={close}
                onConfirm={() => void confirmRevoke()}
                title={t('apiKeys.revoke.title', { name: apiKey.name })}
                confirmLabel={t('apiKeys.revoke.action')}
                confirming={revoke.isPending}
                error={failure}
                errorTitle={t('apiKeys.revoke.errorTitle')}
                errorFallback={t('apiKeys.revoke.errorFallback')}
            >
                {t('apiKeys.revoke.body')}
            </ConfirmModal>
        </Group>
    );
}

function NewKeyForm({ gate, onIssued }: { gate: Gate; onIssued: (issued: ApiKeyIssued) => void }) {
    const { t } = useTranslation('settings');
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
                    <ErrorAlert title={t('apiKeys.create.errorTitle')}>{apiErrorMessage(failure, t('apiKeys.create.errorFallback'))}</ErrorAlert>
                ) : undefined}
                <Group align="flex-end" gap="sm">
                    <TextInput
                        label={t('apiKeys.create.name.label')}
                        description={t('apiKeys.create.name.description')}
                        placeholder={t('apiKeys.create.name.placeholder')}
                        value={name}
                        onChange={event => setName(event.currentTarget.value)}
                        maxLength={100}
                        style={{ flex: '1 1 14rem' }}
                    />
                    <Stack gap={4}>
                        <Text size="sm" fw={500}>
                            {t('apiKeys.column.access')}
                        </Text>
                        <SegmentedControl
                            aria-label={t('apiKeys.column.access')}
                            value={access}
                            onChange={value => setAccess(value as ApiKeyScope)}
                            data={ACCESS_CHOICES.map(choice => ({ value: choice.value, label: choice.label }))}
                        />
                    </Stack>
                    <Select
                        label={t('apiKeys.column.expires')}
                        value={expiry}
                        onChange={value => setExpiry(value ?? 'never')}
                        data={EXPIRY_CHOICES.map(choice => ({ value: choice, label: t(`apiKeys.expiry.${choice}`) }))}
                        allowDeselect={false}
                        w={130}
                    />
                    <Button type="submit" loading={create.isPending} disabled={name.trim().length === 0}>
                        {t('apiKeys.create.action')}
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}
