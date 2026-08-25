import { Anchor, Stack, Table, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogPlaylist, CatalogTrack } from '@deadair/sdk';

import { playlistTracksOptions } from '../../api/playlists.queries';
import { queryKeys } from '../../api/query.keys';
import { PlayPlaylistButton } from '../playout/play.playlist.button';
import { AlbumLink, ArtistLink, TrackLink } from '../shared/catalog.links';
import { formatDuration } from '../shared/format.duration';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';

export interface PlaylistTracksPageProps {
    pluginId: string;
    playlistId: string;
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
            <Stack gap="xxs">
                {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                    router's own types, and with them the check that `params` matches the path. */}
                <Anchor renderRoot={props => <Link to="/playlists" {...props} />} size="sm">
                    Back to playlists
                </Anchor>
                <PageHeader
                    title={heading}
                    description={
                        <Text c="dimmed" size="sm">
                            {`From ${pluginId}`}
                            {tracks.data ? ` • ${tracks.data.tracks.length} tracks` : ''}
                        </Text>
                    }
                    actions={
                        // Only once the tracks are known to exist: airing a playlist that turned out
                        // to be empty is a 422, so offering the button first invites it.
                        //
                        // One button rather than two. Importing this into a lineup first used to be
                        // the "programmed" path; there is no lineup to import into any more, because
                        // the running order is built from this playlist at the moment it goes on.
                        tracks.data && tracks.data.tracks.length > 0 ? <PlayPlaylistButton pluginId={pluginId} playlistId={playlistId} /> : undefined
                    }
                />
            </Stack>

            {tracks.error ? (
                <ErrorAlert title="Tracks could not be loaded" error={tracks.error} fallback="This playlist is unavailable." />
            ) : undefined}

            {tracks.isPending ? <PageSkeleton variant="table" /> : undefined}

            {tracks.data?.tracks.length === 0 ? <EmptyState>This playlist has no tracks.</EmptyState> : undefined}

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
                        {/* A playlist is the PROVIDER's list, so most of these rows are plain text
                            on a library that has not been synced: the ids arrive only for a copy
                            the station has actually ingested, and the three links draw as the words
                            they always were without one. */}
                        {tracks.data.tracks.map((track: CatalogTrack) => (
                            <Table.Tr key={track.id}>
                                <Table.Td>
                                    <TrackLink id={track.trackId}>{track.title}</TrackLink>
                                </Table.Td>
                                <Table.Td>
                                    <ArtistLink id={track.artistId}>{formatArtists(track.artists)}</ArtistLink>
                                </Table.Td>
                                <Table.Td>
                                    <AlbumLink id={track.albumId}>{track.album ?? ''}</AlbumLink>
                                </Table.Td>
                                <Table.Td className="da-num">{formatDuration(track.durationMs)}</Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            ) : undefined}
        </Stack>
    );
}
