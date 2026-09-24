import { ActionIcon, Anchor, Badge, Card, Divider, Group, Menu, Stack, Text, Tooltip } from '@mantine/core';
import { IconDots } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { CatalogPlaylist } from '@deadair/sdk';

import { useRefreshPlaylist, useSetPlaylistHidden } from '../../api/playlists.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { notifyQueued } from '../shared/notify';
import { PlayPlaylistButton } from '../playout/play.playlist.button';
import { canReadTracks } from './playlist.offerable';

export interface PlaylistCardProps {
    playlist: CatalogPlaylist;
}

/**
 * Hide this playlist from the station, or show it again, or read it again now.
 *
 * On every card, refused ones included, which is why it sits in the title row rather than beside Air
 * in the footer: a playlist Spotify will not share has no footer controls, and it is the first kind
 * an operator wants gone. The pending state and any failure live on the trigger, as they do on
 * the personas page, because a menu item has no `loading` and the dropdown closes on the click.
 *
 * Refresh is offered only where the station would actually read the playlist: not once it is
 * hidden, and not when the source has said the account may not read it.
 */
function PlaylistMenu({ playlist }: { playlist: CatalogPlaylist }) {
    const { t } = useTranslation('playlists');
    const change = useSetPlaylistHidden();
    const refresh = useRefreshPlaylist();
    const hidden = playlist.hidden === true;
    const refreshable = !hidden && canReadTracks(playlist);
    const failure = change.isError
        ? apiErrorMessage(change.error, hidden ? t('card.showFailed') : t('card.hideFailed'))
        : refresh.isError
          ? apiErrorMessage(refresh.error, t('card.refreshFailed'))
          : undefined;

    return (
        <Menu position="bottom-end" withinPortal>
            <Menu.Target>
                <Tooltip label={failure} disabled={!failure} color="red" multiline maw={320}>
                    <ActionIcon
                        variant="subtle"
                        color={failure ? 'red' : 'gray'}
                        loading={change.isPending || refresh.isPending}
                        aria-label={t('card.more', { name: playlist.name })}
                    >
                        <IconDots size={16} />
                    </ActionIcon>
                </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
                {refreshable ? (
                    <Menu.Item
                        onClick={() =>
                            refresh.mutate(
                                { pluginId: playlist.pluginId, playlistId: playlist.id },
                                { onSuccess: () => notifyQueued(t('card.refreshQueued', { name: playlist.name })) },
                            )
                        }
                    >
                        {t('card.refresh')}
                    </Menu.Item>
                ) : undefined}
                <Menu.Item onClick={() => change.mutate({ pluginId: playlist.pluginId, playlistId: playlist.id, hidden: !hidden })}>
                    {hidden ? t('card.show') : t('card.hide')}
                </Menu.Item>
                <Menu.Label maw={260} style={{ whiteSpace: 'normal' }}>
                    {hidden ? t('card.showHint') : t('card.hideHint')}
                </Menu.Label>
            </Menu.Dropdown>
        </Menu>
    );
}

/** One importable playlist: what it is, which plugin offers it, and a way in. */
export function PlaylistCard({ playlist }: PlaylistCardProps) {
    const { t } = useTranslation('playlists');
    return (
        <Card padding="lg">
            <Stack gap="sm" h="100%">
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                    <Stack gap="xxxs" style={{ minWidth: 0 }}>
                        <Text fw={600} size="lg" lh={1.2}>
                            {playlist.name}
                        </Text>
                        <Badge size="sm" variant="light" color="gray" tt="none">
                            {playlist.pluginName}
                        </Badge>
                    </Stack>
                    <PlaylistMenu playlist={playlist} />
                </Group>

                <Text size="sm" c="dimmed" lineClamp={2}>
                    {playlist.description ?? t('card.noDescription')}
                </Text>

                {playlist.trackCount !== undefined ? (
                    <Text size="xs" c="dimmed">
                        {t('card.trackCount', { count: playlist.trackCount })}
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
                            {t('card.viewTracks')}
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
                        {t('card.refused', { plugin: playlist.pluginName })}
                    </Text>
                )}
            </Stack>
        </Card>
    );
}
