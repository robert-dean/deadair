import { Alert, Card, List, SimpleGrid, Skeleton, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

import { playlistsListOptions } from '../../api/playlists.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { PlaylistCard } from './playlist.card';

export function PlaylistsPage() {
    const playlists = useQuery(playlistsListOptions);
    const sourceErrors = playlists.data?.errors ?? [];

    return (
        <Stack gap="lg">
            <Stack gap={4}>
                <Title order={1}>Playlists</Title>
                <Text c="dimmed" size="sm">
                    {playlists.data ? `${playlists.data.playlists.length} available` : 'Everything the enabled catalog plugins can offer.'}
                </Text>
            </Stack>

            {playlists.error ? (
                <Alert color="red" title="Playlists could not be loaded">
                    {apiErrorMessage(playlists.error, 'The playlist catalogue is unavailable.')}
                </Alert>
            ) : undefined}

            {sourceErrors.length > 0 ? (
                <Alert color="yellow" title="Some plugins could not be reached">
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
                        <Skeleton key={index} height={196} radius="sm" />
                    ))}
                </SimpleGrid>
            ) : undefined}

            {playlists.data?.playlists.length === 0 ? (
                <Card withBorder padding="xl" radius="sm">
                    <Stack gap="xs">
                        <Text fw={600}>No playlists are available</Text>
                        <Text size="sm" c="dimmed" maw={520}>
                            Enable a plugin with the <Text span ff="monospace">catalog</Text> capability to see its playlists here.
                        </Text>
                    </Stack>
                </Card>
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
