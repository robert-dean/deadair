import { Button, Tooltip } from '@mantine/core';

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
            <Button
                size={size}
                variant={variant}
                color={failure ? 'red' : undefined}
                loading={play.isPending}
                onClick={() => play.mutate({ pluginId, playlistId })}
            >
                {failure ? 'Failed' : 'Air this playlist'}
            </Button>
        </Tooltip>
    );
}
