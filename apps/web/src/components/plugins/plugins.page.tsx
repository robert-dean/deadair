import { Alert, Button, Card, Group, SimpleGrid, Skeleton, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

import { pluginsListOptions, useRescanPlugins } from '../../api/plugins.queries';
import { apiErrorMessage, sdkError } from '../../api/sdk.error';
import { PluginCard } from './plugin.card';

/** What a rescan refusal means, in the operator's terms rather than the transport's. */
function rescanError(error: unknown): string {
    if (sdkError(error)?.status === 403) {
        return 'Rescanning the plugin directory is an administrator action.';
    }
    return apiErrorMessage(error, 'The plugin directory could not be rescanned.');
}

export function PluginsPage() {
    const plugins = useQuery(pluginsListOptions);
    const rescan = useRescanPlugins();

    return (
        <Stack gap="lg">
            <Group justify="space-between" align="flex-end">
                <Stack gap={4}>
                    <Title order={1}>Plugins</Title>
                    <Text c="dimmed" size="sm">
                        {plugins.data ? `${plugins.data.length} installed` : 'Everything the host has mounted.'}
                    </Text>
                </Stack>
                <Button
                    variant="default"
                    size="compact-sm"
                    loading={rescan.isPending}
                    onClick={() => {
                        rescan.mutate();
                    }}
                >
                    Rescan
                </Button>
            </Group>

            {rescan.error ? (
                <Alert color="yellow" title="Rescan failed">
                    {rescanError(rescan.error)}
                </Alert>
            ) : undefined}

            {plugins.error ? (
                <Alert color="red" title="Plugins could not be loaded">
                    {apiErrorMessage(plugins.error, 'The plugin catalogue is unavailable.')}
                </Alert>
            ) : undefined}

            {plugins.isPending ? (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                    {[0, 1, 2].map(index => (
                        <Skeleton key={index} height={196} radius="sm" />
                    ))}
                </SimpleGrid>
            ) : undefined}

            {plugins.data?.length === 0 ? (
                <Card withBorder padding="xl" radius="sm">
                    <Stack gap="xs">
                        <Text fw={600}>No plugins are mounted</Text>
                        <Text size="sm" c="dimmed" maw={520}>
                            Drop a plugin into the host&apos;s plugin directory and rescan. Nothing about the station changes until one is enabled.
                        </Text>
                    </Stack>
                </Card>
            ) : undefined}

            {plugins.data && plugins.data.length > 0 ? (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                    {plugins.data.map(plugin => (
                        <PluginCard key={plugin.id} plugin={plugin} />
                    ))}
                </SimpleGrid>
            ) : undefined}
        </Stack>
    );
}
