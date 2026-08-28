import { Anchor, Badge, Card, Divider, Group, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { CatalogPlaylist } from '@deadair/sdk';

import { PlayPlaylistButton } from '../playout/play.playlist.button';

export interface PlaylistCardProps {
    playlist: CatalogPlaylist;
}

/**
 * Whether the source will hand over this playlist's tracks.
 *
 * Absent permissions mean the source did not say, and that has to stay
 * clickable: most providers never populate the field at all, and Spotify leaves
 * it off when it could not check. Reading "no answer" as "refused" would hide
 * playlists that work perfectly well. Only an explicit list that omits `read`
 * disables the link.
 */
function canReadTracks(playlist: CatalogPlaylist): boolean {
    return playlist.permissions?.includes('read') ?? true;
}

/** One importable playlist: what it is, which plugin offers it, and a way in. */
export function PlaylistCard({ playlist }: PlaylistCardProps) {
    return (
        <Card padding="lg">
            <Stack gap="sm" h="100%">
                <Stack gap="xxxs">
                    <Text fw={600} size="lg" lh={1.2}>
                        {playlist.name}
                    </Text>
                    <Badge size="sm" variant="light" color="gray" tt="none">
                        {playlist.pluginName}
                    </Badge>
                </Stack>

                <Text size="sm" c="dimmed" lineClamp={2}>
                    {playlist.description ?? 'No description.'}
                </Text>

                {playlist.trackCount !== undefined ? (
                    <Text size="xs" c="dimmed">
                        {playlist.trackCount} tracks
                    </Text>
                ) : undefined}

                <Divider mt="auto" />

                {canReadTracks(playlist) ? (
                    <Group justify="space-between" wrap="nowrap">
                        {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                            router's own types, and with them the check that `params` matches the path. */}
                        <Anchor
                            renderRoot={(props: object) => (
                                <Link
                                    to="/playlists/$pluginId/$playlistId"
                                    params={{ pluginId: playlist.pluginId, playlistId: playlist.id }}
                                    {...props}
                                />
                            )}
                            size="sm"
                        >
                            View tracks
                        </Anchor>
                        {/* Gated on the same permission as the link: a playlist whose tracks the
                            source will not hand over cannot be aired either. */}
                        <PlayPlaylistButton pluginId={playlist.pluginId} playlistId={playlist.id} size="xs" />
                    </Group>
                ) : (
                    /* Deliberately not a disabled link: a card that says why is
                       less confusing than one whose only affordance quietly does
                       nothing, and less confusing than the playlist vanishing. */
                    <Text size="sm" c="dimmed">
                        {playlist.pluginName} won&apos;t share this playlist&apos;s tracks.
                    </Text>
                )}
            </Stack>
        </Card>
    );
}
