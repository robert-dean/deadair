import { Badge, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { PluginSummary } from '@deadair/sdk';

export interface PluginTrustDialogProps {
    plugin: PluginSummary;
    opened: boolean;
    onCancel(): void;
    onConfirm(): void;
}

/**
 * The informed opt-in gate for turning a plugin on.
 *
 * Plugins are trusted code, permanently (`packages/plugin-sdk/CLAUDE.md` § "Trust and egress"): a
 * plugin is code you chose to install, running inside this process with this process's own
 * privileges, not code contained in a sandbox. Enabling one is the moment that trust is actually
 * extended, so this dialog says so plainly instead of implying a boundary that does not exist.
 * Disabling needs no such consent, which is why only the enable path is gated.
 */
export function PluginTrustDialog({ plugin, opened, onCancel, onConfirm }: PluginTrustDialogProps) {
    const { t } = useTranslation(['plugins', 'common']);
    return (
        <Modal opened={opened} onClose={onCancel} title={t('trust.title', { name: plugin.name })} centered>
            <Stack gap="md">
                <Text size="sm">{t('trust.body', { name: plugin.name })}</Text>

                <Text size="sm">{t('trust.advice')}</Text>

                <Stack gap="xxs">
                    <Text size="xs" c="dimmed" ff="monospace">
                        {plugin.id} · {plugin.version}
                    </Text>
                    <Group gap="xxs">
                        <Text size="xs" c="dimmed">
                            {t('trust.capabilities')}
                        </Text>
                        {plugin.capabilities.map(capability => (
                            <Badge key={capability} size="sm" variant="light" color="gray" tt="none">
                                {capability}
                            </Badge>
                        ))}
                    </Group>
                </Stack>

                <Group justify="flex-end">
                    <Button variant="default" onClick={onCancel}>
                        {t('common:action.cancel')}
                    </Button>
                    {/* Not styled as destructive: enabling a plugin deliberately is a normal action, not an alarm. */}
                    <Button onClick={onConfirm}>{t('trust.confirm', { name: plugin.name })}</Button>
                </Group>

                {/* Shown on the FIRST enable alone. `plugin_configs.first_enabled_at` is the record
                    that makes that possible, and the caller reads it: there is no "do not ask
                    again" box here because the answer is the enable itself. */}
            </Stack>
        </Modal>
    );
}
