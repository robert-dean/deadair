import { Badge, Button, Group, Modal, Stack, Text } from '@mantine/core';
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
 * `docs/decisions/plugin-isolation.md` chose option B, "trusted but serializable": a plugin is
 * code you chose to install, running inside this process with this process's own privileges, not
 * code contained in a sandbox. Enabling one is the moment that trust is actually extended, so this
 * dialog says so plainly instead of implying a boundary that does not exist. Disabling needs no
 * such consent, which is why only the enable path is gated.
 */
export function PluginTrustDialog({ plugin, opened, onCancel, onConfirm }: PluginTrustDialogProps) {
    return (
        <Modal opened={opened} onClose={onCancel} title={`Enable ${plugin.name}?`} centered>
            <Stack gap="md">
                <Text size="sm">
                    Plugins are trusted code. {plugin.name} runs inside the deadair server process with the server&apos;s own
                    privileges. It can read and write your files, open network connections to anywhere, and read the
                    server&apos;s environment, including database and encryption credentials. The permissions a plugin
                    declares are a description of what it says it needs, not a limit on what it can do.
                </Text>

                <Text size="sm">
                    Enable a plugin the same way you would add a dependency to this project: because you trust who wrote it.
                </Text>

                <Stack gap={6}>
                    <Text size="xs" c="dimmed" ff="monospace">
                        {plugin.id} · {plugin.version} · {plugin.kind}
                    </Text>
                    <Group gap={6}>
                        <Text size="xs" c="dimmed">
                            Declared capabilities:
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
                        Cancel
                    </Button>
                    {/* Not styled as destructive: enabling a plugin deliberately is a normal action, not an alarm. */}
                    <Button onClick={onConfirm}>Enable {plugin.name}</Button>
                </Group>

                {/* No "do not ask again": persisting consent needs a server-side record and a contract
                    change, both out of scope here, so this dialog appears on every enable. */}
            </Stack>
        </Modal>
    );
}
