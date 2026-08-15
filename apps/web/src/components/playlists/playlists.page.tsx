import { Alert, List, SimpleGrid, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

import { playlistsListOptions } from '../../api/playlists.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { PlaylistCard } from './playlist.card';

export function PlaylistsPage() {
    const playlists = useQuery(playlistsListOptions);
    const sourceErrors = playlists.data?.errors ?? [];

    return (
        <Stack gap="lg">
            <PageHeader
                title="Playlists"
                description={
                    <Text c="dimmed" size="sm">
                        {playlists.data ? `${playlists.data.playlists.length} available` : 'Everything the enabled catalog plugins can offer.'}
                    </Text>
                }
            />

            {playlists.error ? (
                <ErrorAlert title="Playlists could not be loaded" error={playlists.error} fallback="The playlist catalogue is unavailable." />
            ) : undefined}

            {sourceErrors.length > 0 ? (
                <Alert color="yellow" title="Some plugins could not be listed">
                    <List size="sm">
                        {sourceErrors.map(error => (
                            <List.Item key={error.pluginId}>
                                {error.pluginName}: {error.message}
                            </List.Item>
                        ))}
                    </List>
                </Alert>
            ) : undefined}

            {playlists.isPending ? (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                    {[0, 1, 2].map(index => (
                        <PageSkeleton key={index} variant="card" />
                    ))}
                </SimpleGrid>
            ) : undefined}

            {playlists.data?.playlists.length === 0 ? (
                <EmptyState title="No playlists are available">
                    {/* Never both stories at once. Telling an operator to enable a plugin
                        directly under a warning that their enabled plugin has failed sends
                        them to the wrong screen; the alert above already says what to do. */}
                    {sourceErrors.length > 0 ? (
                        'The plugins that could offer playlists are listed above, with why each one could not be.'
                    ) : (
                        <>
                            Enable a plugin with the{' '}
                            <Text span ff="monospace">
                                catalog
                            </Text>{' '}
                            capability to see its playlists here.
                        </>
                    )}
                </EmptyState>
            ) : undefined}

            {playlists.data && playlists.data.playlists.length > 0 ? (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                    {playlists.data.playlists.map(playlist => (
                        <PlaylistCard key={`${playlist.pluginId}:${playlist.id}`} playlist={playlist} />
                    ))}
                </SimpleGrid>
            ) : undefined}
        </Stack>
    );
}
