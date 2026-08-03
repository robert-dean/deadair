import { Alert, Anchor, Card, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogPlaylist, CatalogTrack } from '@deadair/sdk';

import { playlistTracksOptions } from '../../api/playlists.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { queryKeys } from '../../api/query.keys';

export interface PlaylistTracksPageProps {
    pluginId: string;
    playlistId: string;
}

/**
 * `m:ss`, not a date library: the input is a duration in milliseconds, not a point in time, and
 * the format never needs to grow past minutes for a single track.
 */
function formatDuration(durationMs: number | undefined): string {
    if (durationMs === undefined) {
        return '';
    }
    const totalSeconds = Math.round(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** `artists.join(', ')`, but without a stray separator when the array is documented-empty. */
function formatArtists(artists: string[]): string {
    return artists.length > 0 ? artists.join(', ') : '';
}

export function PlaylistTracksPage({ pluginId, playlistId }: PlaylistTracksPageProps) {
    const tracks = useQuery(playlistTracksOptions(pluginId, playlistId));
    const queryClient = useQueryClient();

    // The tracks endpoint returns no playlist name. Rather than a second request, look the
    // playlist up in the already-cached list from the playlists page; fall back to the raw id
    // when the cache is cold (a deep link or a hard refresh landed here directly).
    const cachedList = queryClient.getQueryData<{ playlists: CatalogPlaylist[] }>(queryKeys.playlists.list());
    const cachedPlaylist = cachedList?.playlists.find(playlist => playlist.pluginId === pluginId && playlist.id === playlistId);
    const heading = cachedPlaylist?.name ?? playlistId;

    return (
        <Stack gap="lg">
            <Stack gap={4}>
                {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                    router's own types, and with them the check that `params` matches the path. */}
                <Anchor renderRoot={props => <Link to="/playlists" {...props} />} size="sm">
                    Back to playlists
                </Anchor>
                <Title order={1}>{heading}</Title>
                <Text c="dimmed" size="sm">
                    {`From ${pluginId}`}
                    {tracks.data ? ` • ${tracks.data.tracks.length} tracks` : ''}
                </Text>
            </Stack>

            {tracks.error ? (
                <Alert color="red" title="Tracks could not be loaded">
                    {apiErrorMessage(tracks.error, 'This playlist is unavailable.')}
                </Alert>
            ) : undefined}

            {tracks.isPending ? <Skeleton height={240} radius="sm" /> : undefined}

            {tracks.data?.tracks.length === 0 ? (
                <Card withBorder padding="xl" radius="sm">
                    <Text size="sm" c="dimmed">
                        This playlist has no tracks.
                    </Text>
                </Card>
            ) : undefined}

            {tracks.data && tracks.data.tracks.length > 0 ? (
                <Table>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Title</Table.Th>
                            <Table.Th>Artists</Table.Th>
                            <Table.Th>Album</Table.Th>
                            <Table.Th>Duration</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {tracks.data.tracks.map((track: CatalogTrack) => (
                            <Table.Tr key={track.id}>
                                <Table.Td>{track.title}</Table.Td>
                                <Table.Td>{formatArtists(track.artists)}</Table.Td>
                                <Table.Td>{track.album ?? ''}</Table.Td>
                                <Table.Td>{formatDuration(track.durationMs)}</Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            ) : undefined}
        </Stack>
    );
}
