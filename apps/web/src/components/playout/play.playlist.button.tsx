import { ActionIcon, Button, Group, Menu, Tooltip } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';

import { usePlayPlaylist } from '../../api/playout.queries';
import { apiErrorMessage } from '../../api/sdk.error';

export interface PlayPlaylistButtonProps {
    pluginId: string;
    playlistId: string;
    /** False when the source will not hand over this playlist's tracks. */
    playable?: boolean;
    size?: 'xs' | 'sm';
    variant?: string;
}

/**
 * Loads a plugin playlist into the station's running order.
 *
 * This is a broadcast action, not a preview: it replaces whatever was queued and
 * goes out over the mount to every listener. The label says "Air", not "Play",
 * for that reason — nothing here plays audio in the browser.
 *
 * ## The second way to air it
 *
 * The chevron offers the same press with similar records mixed in, the way a smart shuffle does:
 * a record by an artist who sounds like one of the playlist's own every few records. A menu rather
 * than a checkbox beside the button, because the button also sits on a compact card, and because the
 * ordinary press must keep sending NOTHING about it: absent leaves `rotation.mixInSimilar` standing,
 * so a station with that setting on mixes into every playlist without anybody opening the menu.
 */
export function PlayPlaylistButton({ pluginId, playlistId, playable = true, size = 'sm', variant = 'light' }: PlayPlaylistButtonProps) {
    const play = usePlayPlaylist();

    if (!playable) {
        return undefined;
    }

    // The failure is kept on the button rather than raised as a page-level alert:
    // it belongs to this action, and the transport bar reports the station's own
    // state independently of whether this request landed.
    const failure = play.isError ? apiErrorMessage(play.error, 'That playlist could not be aired.') : undefined;

    return (
        <Tooltip label={failure} disabled={!failure} color="red" multiline maw={320}>
            <Group gap={2} wrap="nowrap">
                <Button
                    size={size}
                    variant={variant}
                    color={failure ? 'red' : undefined}
                    loading={play.isPending}
                    onClick={() => play.mutate({ pluginId, playlistId })}
                >
                    {failure ? 'Failed' : 'Air this playlist'}
                </Button>
                <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                        <ActionIcon
                            size={size === 'xs' ? 30 : 36}
                            variant={variant}
                            color={failure ? 'red' : undefined}
                            disabled={play.isPending}
                            aria-label="More ways to air this playlist"
                        >
                            <IconChevronDown size={14} stroke={1.8} />
                        </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                        <Menu.Item onClick={() => play.mutate({ pluginId, playlistId, mixInSimilar: true })}>
                            Air with similar records mixed in
                        </Menu.Item>
                        <Menu.Label maw={260} style={{ whiteSpace: 'normal' }}>
                            A record by an artist who sounds like one of its own, every few records. Needs a similarity plugin.
                        </Menu.Label>
                    </Menu.Dropdown>
                </Menu>
            </Group>
        </Tooltip>
    );
}
