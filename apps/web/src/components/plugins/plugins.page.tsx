import { useState } from 'react';
import { Button, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

import { pluginsListOptions, useRescanPlugins } from '../../api/plugins.queries';
import { apiErrorMessage, sdkError } from '../../api/sdk.error';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { PluginCard } from './plugin.card';
import { PluginImportModal } from './plugin.import.modal';

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
    const [importing, setImporting] = useState(false);

    return (
        <Stack gap="lg">
            <PageHeader
                title="Plugins"
                description={
                    <Text c="dimmed" size="sm">
                        {plugins.data ? `${plugins.data.length} installed` : 'Everything the host has mounted.'}
                    </Text>
                }
                actions={
                    <Group gap="xs">
                        <Button variant="default" size="compact-sm" onClick={() => setImporting(true)}>
                            Import
                        </Button>
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
                }
            />

            <PluginImportModal opened={importing} onClose={() => setImporting(false)} />

            {rescan.error ? (
                <ErrorAlert tone="warning" title="Rescan failed">
                    {rescanError(rescan.error)}
                </ErrorAlert>
            ) : undefined}

            {plugins.error ? (
                <ErrorAlert title="Plugins could not be loaded" error={plugins.error} fallback="The plugin catalogue is unavailable." />
            ) : undefined}

            {plugins.isPending ? (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                    {[0, 1, 2].map(index => (
                        <PageSkeleton key={index} variant="card" />
                    ))}
                </SimpleGrid>
            ) : undefined}

            {plugins.data?.length === 0 ? (
                <EmptyState title="No plugins are mounted">
                    Import a plugin, or drop one into the host&apos;s plugin directory and rescan. Nothing about the station changes until one is
                    enabled.
                </EmptyState>
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
