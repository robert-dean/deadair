import { Anchor, Badge, Card, Divider, Group, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { StationPlaylist } from '@deadair/sdk';

import { pluginsListOptions } from '../../api/plugins.queries';
import { PlayStationPlaylistButton } from '../playout/play.playlist.button';

/** The plugin a station playlist was cloned from, by the name an operator knows it by. */
export function usePluginName(pluginId: string | undefined): string | undefined {
    const plugins = useQuery({ ...pluginsListOptions, enabled: pluginId !== undefined });
    if (pluginId === undefined) return undefined;
    return plugins.data?.find(plugin => plugin.id === pluginId)?.name ?? pluginId;
}

/** What a station playlist holds, as one line: how many records, and how many of them can air. */
export function holdingLine(playlist: Pick<StationPlaylist, 'trackCount' | 'resolvedCount'>): string {
    const records = `${playlist.trackCount} ${playlist.trackCount === 1 ? 'record' : 'records'}`;
    if (playlist.resolvedCount === playlist.trackCount) return records;
    return `${records} · ${playlist.resolvedCount} in the library`;
}

/** One playlist the station owns: what it is, where it was cloned from, and a way in. */
export function StationPlaylistCard({ playlist }: { playlist: StationPlaylist }) {
    const origin = usePluginName(playlist.originPluginId);

    return (
        <Card padding="lg">
            <Stack gap="sm" h="100%">
                <Stack gap="xxxs" style={{ minWidth: 0 }}>
                    <Text fw={600} size="lg" lh={1.2}>
                        {playlist.name}
                    </Text>
                    <Group gap="xs">
                        <Badge size="sm" variant="light" color="grape" tt="none">
                            Station
                        </Badge>
                        {origin === undefined ? undefined : (
                            <Badge size="sm" variant="light" color="gray" tt="none">
                                {`From ${origin}`}
                            </Badge>
                        )}
                    </Group>
                </Stack>

                {playlist.prompt.length > 0 ? (
                    <Text size="sm" c="dimmed" lineClamp={2}>
                        {playlist.prompt}
                    </Text>
                ) : undefined}

                <Text size="xs" c="dimmed" className="da-num">
                    {holdingLine(playlist)}
                </Text>

                <Divider mt="auto" />

                <Group justify="space-between" wrap="nowrap">
                    {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                        router's own types, and with them the check that `params` matches the path. */}
                    <Anchor renderRoot={(props: object) => <Link to="/station-playlists/$id" params={{ id: playlist.id }} {...props} />} size="sm">
                        View records
                    </Anchor>
                    {/* Only when something on it can air: one made of nothing but placeholders is refused. */}
                    {playlist.resolvedCount > 0 ? <PlayStationPlaylistButton stationPlaylistId={playlist.id} size="xs" /> : undefined}
                </Group>
            </Stack>
        </Card>
    );
}
