import { useState } from 'react';
import { Alert, Badge, Button, Card, Code, Group, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
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

const METHODS: ReadonlyArray<{ value: OAuthClientAuthMethod; label: string }> = [
    { value: 'none', label: 'No secret (an app on somebody’s own device)' },
    { value: 'client_secret_post', label: 'Keeps a secret, sent in the request' },
    { value: 'client_secret_basic', label: 'Keeps a secret, sent as HTTP Basic' },
];

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
    const clients = useOAuthClients();
    const gate = useStepUpGate();
    const [issued, setIssued] = useState<OAuthClientIssued>();

    if (sdkError(clients.error)?.status === 403) return undefined;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        Registered apps
                    </Title>
                    <Text size="sm" c="dimmed">
                        Apps allowed to ask somebody here for access. Registering one gives it nothing until a person approves it.
                    </Text>
                </Stack>

                {issued ? <IssuedPanel issued={issued} onDone={() => setIssued(undefined)} /> : undefined}
                {clients.isPending ? <PageSkeleton variant="rows" count={2} /> : undefined}
                {clients.error ? (
                    <ErrorAlert title="Apps unavailable" error={clients.error} fallback="The station could not list its apps." />
                ) : undefined}

                {clients.data ? (
                    <Stack gap="xs">
                        {clients.data.clients.map(client => (
                            <ClientRow key={client.clientId} client={client} />
                        ))}
                        {clients.data.clients.length === 0 ? (
                            <Text size="sm" c="dimmed">
                                None yet.
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
    return (
        <Alert color="yellow" variant="light" title={`${issued.client.name ?? issued.client.clientId}: registered`}>
            <Stack gap="xs">
                <Text size="sm">Client id</Text>
                <Group gap="xs" wrap="nowrap">
                    <Code style={{ overflowWrap: 'anywhere', flex: 1 }}>{issued.client.clientId}</Code>
                    <CopyButton value={issued.client.clientId} />
                </Group>
                {issued.clientSecret ? (
                    <>
                        <Text size="sm">Client secret. This is the only time it is shown: copy it now.</Text>
                        <Group gap="xs" wrap="nowrap">
                            <Code style={{ overflowWrap: 'anywhere', flex: 1 }}>{issued.clientSecret}</Code>
                            <CopyButton value={issued.clientSecret} />
                        </Group>
                    </>
                ) : undefined}
                <Button variant="default" size="compact-sm" w="fit-content" onClick={onDone}>
                    Done
                </Button>
            </Stack>
        </Alert>
    );
}

function ClientRow({ client }: { client: OAuthClientSummary }) {
    const revoke = useRevokeOAuthClient();
    const [confirming, setConfirming] = useState(false);
    const name = client.name ?? client.clientId;

    return (
        <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2}>
                <Group gap="xs">
                    <Text size="sm">{name}</Text>
                    <Badge variant="light" color="gray">
                        {client.kind === 'dynamic' ? 'registered itself' : 'registered here'}
                    </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                    {client.lastUsedAt ? `Last used ${formatDate(client.lastUsedAt)}` : 'Never used'}
                    {client.expiresAt ? ` · lapses ${formatDate(client.expiresAt)} unless used again` : ''}
                </Text>
            </Stack>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming(true)}>
                Withdraw
            </Button>
            <ConfirmModal
                opened={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={() =>
                    void revoke.mutateAsync(client.clientId).then(() => {
                        setConfirming(false);
                        notifyDone(`${name} withdrawn.`);
                    })
                }
                title={`Withdraw ${name}?`}
                confirmLabel="Withdraw"
                confirming={revoke.isPending}
                error={revoke.error}
                errorTitle="Not withdrawn"
                errorFallback="The app is still registered."
            >
                {`Everybody who approved ${name} is disconnected from it, and every token it holds stops working. An app that registers itself can register again, and somebody will have to approve it again.`}
            </ConfirmModal>
        </Group>
    );
}

function NewClientForm({ gate, onIssued }: { gate: Gate; onIssued: (issued: OAuthClientIssued) => void }) {
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
                Register an app by hand
            </Text>
            {create.error ? <ErrorAlert title="Not registered" error={create.error} fallback="The station did not register it." /> : undefined}
            <TextInput label="Name" value={name} onChange={event => setName(event.currentTarget.value)} maxLength={100} />
            <Textarea
                label="Where it may be sent back to"
                description="One address per line: https, or this computer's own (http://127.0.0.1/…)."
                value={redirects}
                onChange={event => setRedirects(event.currentTarget.value)}
                autosize
                minRows={2}
            />
            <Select
                label="Secret"
                data={[...METHODS]}
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
                Register
            </Button>
        </Stack>
    );
}
