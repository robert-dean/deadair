import { ActionIcon, Button, Group, Menu, Tooltip } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';

import { usePlayPlaylist, usePlayStationPlaylist } from '../../api/playout.queries';
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

    return (
        <AirButton
            onAir={mixInSimilar => play.mutate({ pluginId, playlistId, ...(mixInSimilar ? { mixInSimilar } : {}) })}
            pending={play.isPending}
            error={play.isError ? play.error : undefined}
            size={size}
            variant={variant}
        />
    );
}

export interface PlayStationPlaylistButtonProps {
    stationPlaylistId: string;
    size?: 'xs' | 'sm';
    variant?: string;
}

/** The same two presses for a playlist the station owns, whose records air from whichever copy serves them. */
export function PlayStationPlaylistButton({ stationPlaylistId, size = 'sm', variant = 'light' }: PlayStationPlaylistButtonProps) {
    const play = usePlayStationPlaylist();

    return (
        <AirButton
            onAir={mixInSimilar => play.mutate({ stationPlaylistId, ...(mixInSimilar ? { mixInSimilar } : {}) })}
            pending={play.isPending}
            error={play.isError ? play.error : undefined}
            size={size}
            variant={variant}
        />
    );
}

interface AirButtonProps {
    /** Air it, with similar records mixed in when `true`, and saying nothing about them otherwise. */
    onAir: (mixInSimilar?: true) => void;
    pending: boolean;
    error: unknown;
    size: 'xs' | 'sm';
    variant: string;
}

function AirButton({ onAir, pending, error, size, variant }: AirButtonProps) {
    // The failure is kept on the button rather than raised as a page-level alert:
    // it belongs to this action, and the transport bar reports the station's own
    // state independently of whether this request landed.
    const failure = error === undefined ? undefined : apiErrorMessage(error, 'That playlist could not be aired.');

    return (
        <Tooltip label={failure} disabled={!failure} color="red" multiline maw={320}>
            <Group gap={2} wrap="nowrap">
                <Button size={size} variant={variant} color={failure ? 'red' : undefined} loading={pending} onClick={() => onAir()}>
                    {failure ? 'Failed' : 'Air this playlist'}
                </Button>
                <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                        <ActionIcon
                            size={size === 'xs' ? 30 : 36}
                            variant={variant}
                            color={failure ? 'red' : undefined}
                            disabled={pending}
                            aria-label="More ways to air this playlist"
                        >
                            <IconChevronDown size={14} stroke={1.8} />
                        </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                        <Menu.Item onClick={() => onAir(true)}>Air with similar records mixed in</Menu.Item>
                        <Menu.Label maw={260} style={{ whiteSpace: 'normal' }}>
                            A record by an artist who sounds like one of its own, every few records. Needs a similarity plugin.
                        </Menu.Label>
                    </Menu.Dropdown>
                </Menu>
            </Group>
        </Tooltip>
    );
}
