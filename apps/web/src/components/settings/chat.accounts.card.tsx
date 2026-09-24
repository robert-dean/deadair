import { useState } from 'react';
import { Alert, Button, Card, Code, Group, Stack, Text, Title } from '@mantine/core';
import type { MessagingLink, MessagingLinkCode } from '@deadair/sdk';

import { useCreateMessagingLinkCode, useMessagingLinks, useRemoveMessagingLink } from '../../api/messaging.queries';
import { sdkError } from '../../api/sdk.error';
import { ConfirmModal } from '../shared/confirm.modal';
import { CopyButton } from '../shared/copy.button';
import { ErrorAlert } from '../shared/error.alert';
import { formatDate } from '../shared/format.date';
import { notifyDone } from '../shared/notify';

/** A plugin id as a person would say it: `deadair.telegram` is Telegram. */
const platformName = (pluginId: string): string => {
    const last = pluginId.split('.').pop() ?? pluginId;
    return last.charAt(0).toUpperCase() + last.slice(1);
};

/**
 * The chat accounts that may run operator commands as this account, and the code that links another.
 *
 * Beside the API keys because it is the same kind of thing: a way for something outside the console
 * to act as this person. The code is shown once and held only in this component, for the reason the
 * key card gives for its token. An operator's card: somebody without the role sees nothing here, for
 * `OAuthClientsCard`'s reason.
 */
export function ChatAccountsCard() {
    const links = useMessagingLinks();
    const create = useCreateMessagingLinkCode();
    const [code, setCode] = useState<MessagingLinkCode>();

    if (sdkError(links.error)?.status === 403) return undefined;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        Chat accounts
                    </Title>
                    <Text size="sm" c="dimmed">
                        Link your account on a chat platform, such as Telegram, to skip a record or take the station off the air from a chat. It can
                        do only what you can.
                    </Text>
                </Stack>
                {links.error ? (
                    <ErrorAlert title="Chat accounts unavailable" error={links.error} fallback="The station could not list your chat accounts." />
                ) : undefined}
                {links.data && links.data.links.length > 0 ? (
                    <Stack gap="xs">
                        {links.data.links.map(link => (
                            <LinkRow key={`${link.pluginId}:${link.platformUserId}`} link={link} />
                        ))}
                    </Stack>
                ) : undefined}
                {code ? (
                    <Alert color="blue" title="Send this to the station's bot">
                        <Stack gap="xs">
                            <Group gap="xs" wrap="nowrap">
                                <Code style={{ flex: 1 }}>{`/link ${code.code}`}</Code>
                                <CopyButton value={`/link ${code.code}`} />
                            </Group>
                            <Text size="xs">{`In a direct message, not a group. It works once, until ${formatDate(code.expiresAt)}.`}</Text>
                        </Stack>
                    </Alert>
                ) : undefined}
                {create.error ? <ErrorAlert title="No code" error={create.error} fallback="The station could not make a code." /> : undefined}
                <Group>
                    <Button variant="light" loading={create.isPending} onClick={() => void create.mutateAsync().then(setCode)}>
                        {code ? 'New code' : 'Link a chat account'}
                    </Button>
                </Group>
            </Stack>
        </Card>
    );
}

function LinkRow({ link }: { link: MessagingLink }) {
    const remove = useRemoveMessagingLink();
    const [confirming, setConfirming] = useState(false);
    const name = `${link.displayName} on ${platformName(link.pluginId)}`;

    return (
        <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2}>
                <Text size="sm">{name}</Text>
                <Text size="xs" c="dimmed">{`Linked ${formatDate(link.createdAt)}`}</Text>
            </Stack>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming(true)}>
                Unlink
            </Button>
            <ConfirmModal
                opened={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={() =>
                    void remove.mutateAsync({ pluginId: link.pluginId, platformUserId: link.platformUserId }).then(() => {
                        setConfirming(false);
                        notifyDone(`${name} unlinked.`);
                    })
                }
                title={`Unlink ${name}?`}
                confirmLabel="Unlink"
                confirming={remove.isPending}
                error={remove.error}
                errorTitle="Still linked"
                errorFallback="The chat account is still linked."
            >
                {'Its operator commands are refused from the next one on. You can link it again with a new code.'}
            </ConfirmModal>
        </Group>
    );
}
