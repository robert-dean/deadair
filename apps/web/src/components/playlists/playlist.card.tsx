import { Anchor, Badge, Card, Divider, Group, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { CatalogPlaylist } from '@deadair/sdk';

export interface PlaylistCardProps {
    playlist: CatalogPlaylist;
}

/** One importable playlist: what it is, which plugin offers it, and a way in. */
export function PlaylistCard({ playlist }: PlaylistCardProps) {
    return (
        <Card withBorder padding="lg" radius="sm">
            <Stack gap="sm" h="100%">
                <Stack gap={2}>
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

                {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                    router's own types, and with them the check that `params` matches the path. */}
                <Anchor
                    renderRoot={props => (
                        <Link to="/playlists/$pluginId/$playlistId" params={{ pluginId: playlist.pluginId, playlistId: playlist.id }} {...props} />
                    )}
                    size="sm"
                >
                    View tracks
                </Anchor>
            </Stack>
        </Card>
    );
}
