import { useState } from 'react';
import { Alert, Badge, Button, Card, Code, Group, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { OAuthClientAuthMethod, OAuthClientIssued, OAuthClientSummary } from '@deadair/sdk';

import { useCreateOAuthClient, useOAuthClients, useRevokeOAuthClient } from '../../api/oauth.queries';
import { sdkError } from '../../api/sdk.error';
import { ConfirmModal } from '../shared/confirm.modal';
import { CopyButton } from '../shared/copy.button';
import { ErrorAlert } from '../shared/error.alert';
import { formatDate } from '../shared/format.date';
import { notifyDone } from '../shared/notify';
import { PageSkeleton } from '../shared/page.skeleton';
import { isStepUpCancelled, StepUpDialog, useStepUpGate } from './step.up.dialog';

type Gate = ReturnType<typeof useStepUpGate>;

const METHODS: readonly OAuthClientAuthMethod[] = ['none', 'client_secret_post', 'client_secret_basic'];

/**
 * The apps registered with the station, below the settings that let them connect.
 *
 * Most never appear here by hand: Claude registers itself each time somebody connects it, and those
 * are listed with the date they lapse unless used again. An operator registers one here for a client
 * that cannot register itself, and gets its secret once. Withdrawing an app ends every approval of
 * it and every token it holds. An operator's list: somebody without the role sees nothing here
 * rather than an error they can do nothing about.
 */
export function OAuthClientsCard() {
    const { t } = useTranslation('settings');
    const clients = useOAuthClients();
    const gate = useStepUpGate();
    const [issued, setIssued] = useState<OAuthClientIssued>();

    if (sdkError(clients.error)?.status === 403) return undefined;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {t('oauthClients.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('oauthClients.intro')}
                    </Text>
                </Stack>

                {issued ? <IssuedPanel issued={issued} onDone={() => setIssued(undefined)} /> : undefined}
                {clients.isPending ? <PageSkeleton variant="rows" count={2} /> : undefined}
                {clients.error ? (
                    <ErrorAlert title={t('oauthClients.unavailable.title')} error={clients.error} fallback={t('oauthClients.unavailable.fallback')} />
                ) : undefined}

                {clients.data ? (
                    <Stack gap="xs">
                        {clients.data.clients.map(client => (
                            <ClientRow key={client.clientId} client={client} />
                        ))}
                        {clients.data.clients.length === 0 ? (
                            <Text size="sm" c="dimmed">
                                {t('oauthClients.none')}
                            </Text>
                        ) : undefined}
                    </Stack>
                ) : undefined}

                {clients.data ? <NewClientForm gate={gate} onIssued={setIssued} /> : undefined}
            </Stack>
            <StepUpDialog gate={gate} />
        </Card>
    );
}

function IssuedPanel({ issued, onDone }: { issued: OAuthClientIssued; onDone: () => void }) {
    const { t } = useTranslation('settings');
    return (
        <Alert color="yellow" variant="light" title={t('oauthClients.issued.title', { name: issued.client.name ?? issued.client.clientId })}>
            <Stack gap="xs">
                <Text size="sm">{t('oauthClients.issued.clientId')}</Text>
                <Group gap="xs" wrap="nowrap">
                    <Code style={{ overflowWrap: 'anywhere', flex: 1 }}>{issued.client.clientId}</Code>
                    <CopyButton value={issued.client.clientId} />
                </Group>
                {issued.clientSecret ? (
                    <>
                        <Text size="sm">{t('oauthClients.issued.clientSecret')}</Text>
                        <Group gap="xs" wrap="nowrap">
                            <Code style={{ overflowWrap: 'anywhere', flex: 1 }}>{issued.clientSecret}</Code>
                            <CopyButton value={issued.clientSecret} />
                        </Group>
                    </>
                ) : undefined}
                <Button variant="default" size="compact-sm" w="fit-content" onClick={onDone}>
                    {t('oauthClients.issued.done')}
                </Button>
            </Stack>
        </Alert>
    );
}

function ClientRow({ client }: { client: OAuthClientSummary }) {
    const { t } = useTranslation('settings');
    const revoke = useRevokeOAuthClient();
    const [confirming, setConfirming] = useState(false);
    const name = client.name ?? client.clientId;

    return (
        <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2}>
                <Group gap="xs">
                    <Text size="sm">{name}</Text>
                    <Badge variant="light" color="gray">
                        {client.kind === 'dynamic' ? t('oauthClients.kind.dynamic') : t('oauthClients.kind.manual')}
                    </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                    {client.lastUsedAt ? t('oauthClients.lastUsed', { date: formatDate(client.lastUsedAt) }) : t('oauthClients.neverUsed')}
                    {client.expiresAt ? t('oauthClients.lapses', { date: formatDate(client.expiresAt) }) : ''}
                </Text>
            </Stack>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming(true)}>
                {t('oauthClients.withdraw.action')}
            </Button>
            <ConfirmModal
                opened={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={() =>
                    void revoke.mutateAsync(client.clientId).then(() => {
                        setConfirming(false);
                        notifyDone(t('oauthClients.withdraw.done', { name }));
                    })
                }
                title={t('oauthClients.withdraw.title', { name })}
                confirmLabel={t('oauthClients.withdraw.action')}
                confirming={revoke.isPending}
                error={revoke.error}
                errorTitle={t('oauthClients.withdraw.errorTitle')}
                errorFallback={t('oauthClients.withdraw.errorFallback')}
            >
                {t('oauthClients.withdraw.body', { name })}
            </ConfirmModal>
        </Group>
    );
}

function NewClientForm({ gate, onIssued }: { gate: Gate; onIssued: (issued: OAuthClientIssued) => void }) {
    const { t } = useTranslation('settings');
    const create = useCreateOAuthClient();
    const [name, setName] = useState('');
    const [redirects, setRedirects] = useState('');
    const [method, setMethod] = useState<OAuthClientAuthMethod>('none');

    async function submit(): Promise<void> {
        const redirectUris = redirects
            .split(/\s+/)
            .map(uri => uri.trim())
            .filter(uri => uri.length > 0);
        try {
            const issued = await gate.run(() => create.mutateAsync({ name: name.trim(), redirectUris, tokenEndpointAuthMethod: method }));
            onIssued(issued);
            setName('');
            setRedirects('');
            setMethod('none');
        } catch (caught) {
            // Closed without a code: nothing was registered, and the form keeps what was typed.
            if (isStepUpCancelled(caught)) return;
        }
    }

    return (
        <Stack gap="xs">
            <Text size="sm" fw={600}>
                {t('oauthClients.create.heading')}
            </Text>
            {create.error ? (
                <ErrorAlert title={t('oauthClients.create.errorTitle')} error={create.error} fallback={t('oauthClients.create.errorFallback')} />
            ) : undefined}
            <TextInput label={t('oauthClients.create.name')} value={name} onChange={event => setName(event.currentTarget.value)} maxLength={100} />
            <Textarea
                label={t('oauthClients.create.redirects.label')}
                description={t('oauthClients.create.redirects.description')}
                value={redirects}
                onChange={event => setRedirects(event.currentTarget.value)}
                autosize
                minRows={2}
            />
            <Select
                label={t('oauthClients.create.secret')}
                data={METHODS.map(value => ({ value, label: t(`oauthClients.method.${value}`) }))}
                value={method}
                onChange={value => setMethod((value ?? 'none') as OAuthClientAuthMethod)}
                allowDeselect={false}
            />
            <Button
                w="fit-content"
                loading={create.isPending}
                disabled={name.trim().length === 0 || redirects.trim().length === 0}
                onClick={() => void submit()}
            >
                {t('oauthClients.create.action')}
            </Button>
        </Stack>
    );
}
