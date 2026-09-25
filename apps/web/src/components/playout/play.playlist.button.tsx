import { ActionIcon, Button, Group, Menu, Tooltip } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

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
 *
 * Calls are the other thing the menu offers, and the opposite way round: they have no station-wide
 * setting, so the ordinary press takes none and only "Air with calls" asks for them.
 */
export function PlayPlaylistButton({ pluginId, playlistId, playable = true, size = 'sm', variant = 'light' }: PlayPlaylistButtonProps) {
    const play = usePlayPlaylist();

    if (!playable) {
        return undefined;
    }

    return (
        <AirButton
            onAir={ask => play.mutate({ pluginId, playlistId, ...ask })}
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
            onAir={ask => play.mutate({ stationPlaylistId, ...ask })}
            pending={play.isPending}
            error={play.isError ? play.error : undefined}
            size={size}
            variant={variant}
        />
    );
}

/** What one press asks for beyond the playlist itself. Each is absent unless that press says it. */
interface AirAsk {
    mixInSimilar?: true;
    callins?: true;
}

interface AirButtonProps {
    /** Air it, saying nothing about anything the press did not ask for. */
    onAir: (ask?: AirAsk) => void;
    pending: boolean;
    error: unknown;
    size: 'xs' | 'sm';
    variant: string;
}

function AirButton({ onAir, pending, error, size, variant }: AirButtonProps) {
    const { t } = useTranslation('playout');
    // The failure is kept on the button rather than raised as a page-level alert:
    // it belongs to this action, and the transport bar reports the station's own
    // state independently of whether this request landed.
    const failure = error === undefined ? undefined : apiErrorMessage(error, t('playlist.failed'));

    return (
        <Tooltip label={failure} disabled={!failure} color="red" multiline maw={320}>
            <Group gap={2} wrap="nowrap">
                <Button size={size} variant={variant} color={failure ? 'red' : undefined} loading={pending} onClick={() => onAir()}>
                    {failure ? t('playlist.failedLabel') : t('playlist.air')}
                </Button>
                <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                        <ActionIcon
                            size={size === 'xs' ? 30 : 36}
                            variant={variant}
                            color={failure ? 'red' : undefined}
                            disabled={pending}
                            aria-label={t('playlist.more')}
                        >
                            <IconChevronDown size={14} stroke={1.8} />
                        </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                        <Menu.Item onClick={() => onAir({ mixInSimilar: true })}>{t('playlist.mixIn')}</Menu.Item>
                        <Menu.Label maw={260} style={{ whiteSpace: 'normal' }}>
                            {t('playlist.mixInHint')}
                        </Menu.Label>
                        <Menu.Item onClick={() => onAir({ callins: true })}>{t('playlist.withCalls')}</Menu.Item>
                    </Menu.Dropdown>
                </Menu>
            </Group>
        </Tooltip>
    );
}
