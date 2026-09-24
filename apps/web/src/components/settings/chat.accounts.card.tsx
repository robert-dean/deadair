import { useState } from 'react';
import { Alert, Button, Card, Code, Group, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
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
    const { t } = useTranslation('settings');
    const links = useMessagingLinks();
    const create = useCreateMessagingLinkCode();
    const [code, setCode] = useState<MessagingLinkCode>();

    if (sdkError(links.error)?.status === 403) return undefined;

    // What the operator sends the bot: a chat command, which is the bot's syntax rather than copy.
    const command = code ? `/link ${code.code}` : '';

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {t('chatAccounts.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('chatAccounts.intro')}
                    </Text>
                </Stack>
                {links.error ? (
                    <ErrorAlert title={t('chatAccounts.unavailable.title')} error={links.error} fallback={t('chatAccounts.unavailable.fallback')} />
                ) : undefined}
                {links.data && links.data.links.length > 0 ? (
                    <Stack gap="xs">
                        {links.data.links.map(link => (
                            <LinkRow key={`${link.pluginId}:${link.platformUserId}`} link={link} />
                        ))}
                    </Stack>
                ) : undefined}
                {code ? (
                    <Alert color="blue" title={t('chatAccounts.code.title')}>
                        <Stack gap="xs">
                            <Group gap="xs" wrap="nowrap">
                                <Code style={{ flex: 1 }}>{command}</Code>
                                <CopyButton value={command} />
                            </Group>
                            <Text size="xs">{t('chatAccounts.code.hint', { date: formatDate(code.expiresAt) })}</Text>
                        </Stack>
                    </Alert>
                ) : undefined}
                {create.error ? (
                    <ErrorAlert title={t('chatAccounts.code.errorTitle')} error={create.error} fallback={t('chatAccounts.code.errorFallback')} />
                ) : undefined}
                <Group>
                    <Button variant="light" loading={create.isPending} onClick={() => void create.mutateAsync().then(setCode)}>
                        {code ? t('chatAccounts.code.again') : t('chatAccounts.code.first')}
                    </Button>
                </Group>
            </Stack>
        </Card>
    );
}

function LinkRow({ link }: { link: MessagingLink }) {
    const { t } = useTranslation('settings');
    const remove = useRemoveMessagingLink();
    const [confirming, setConfirming] = useState(false);
    const name = t('chatAccounts.link.name', { user: link.displayName, platform: platformName(link.pluginId) });

    return (
        <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2}>
                <Text size="sm">{name}</Text>
                <Text size="xs" c="dimmed">
                    {t('chatAccounts.link.linked', { date: formatDate(link.createdAt) })}
                </Text>
            </Stack>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming(true)}>
                {t('chatAccounts.unlink.action')}
            </Button>
            <ConfirmModal
                opened={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={() =>
                    void remove.mutateAsync({ pluginId: link.pluginId, platformUserId: link.platformUserId }).then(() => {
                        setConfirming(false);
                        notifyDone(t('chatAccounts.unlink.done', { name }));
                    })
                }
                title={t('chatAccounts.unlink.title', { name })}
                confirmLabel={t('chatAccounts.unlink.action')}
                confirming={remove.isPending}
                error={remove.error}
                errorTitle={t('chatAccounts.unlink.errorTitle')}
                errorFallback={t('chatAccounts.unlink.errorFallback')}
            >
                {t('chatAccounts.unlink.body')}
            </ConfirmModal>
        </Group>
    );
}
