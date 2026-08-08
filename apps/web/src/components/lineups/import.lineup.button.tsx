import { Button, Tooltip } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import type { LineupMode, LineupOnEnd } from '@deadair/sdk';

import { useImportLineup } from '../../api/director.queries';
import { apiErrorMessage } from '../../api/sdk.error';

export interface ImportLineupButtonProps {
    pluginId: string;
    playlistId: string;
    /** What to call the lineup. Absent lets the API name it after the plugin, which is all it knows. */
    name?: string;
    mode?: LineupMode;
    onEnd?: LineupOnEnd;
    label?: string;
    size?: 'xs' | 'sm';
    variant?: string;
}

/**
 * Builds a lineup out of a provider playlist.
 *
 * Not a broadcast action, which is the whole distinction the API draws: importing copies the
 * playlist into the station's own programming, and nothing goes to air until someone puts the
 * lineup on. That is why this sits beside "Air this playlist" rather than replacing it — one is the
 * quick path, the other is the programmed one.
 *
 * Lands on the new lineup, because the next thing an operator wants is the order they just made.
 */
export function ImportLineupButton({
    pluginId,
    playlistId,
    name,
    mode,
    onEnd,
    label = 'Import as lineup',
    size = 'sm',
    variant = 'default',
}: ImportLineupButtonProps) {
    const navigate = useNavigate();
    const importLineup = useImportLineup();

    // Kept on the button rather than raised as a page-level alert: it belongs to this action, and
    // an empty playlist (422) is the ordinary way it fails.
    const failure = importLineup.isError ? apiErrorMessage(importLineup.error, 'That playlist could not be imported.') : undefined;

    return (
        <Tooltip label={failure} disabled={!failure} color="red" multiline maw={320}>
            <Button
                size={size}
                variant={variant}
                color={failure ? 'red' : undefined}
                loading={importLineup.isPending}
                onClick={() =>
                    importLineup.mutate(
                        {
                            pluginId,
                            playlistId,
                            ...(name === undefined ? {} : { name }),
                            ...(mode === undefined ? {} : { mode }),
                            ...(onEnd === undefined ? {} : { onEnd }),
                        },
                        {
                            onSuccess: lineup => {
                                void navigate({ to: '/lineups/$lineupId', params: { lineupId: lineup.id } });
                            },
                        },
                    )
                }
            >
                {failure ? 'Failed' : label}
            </Button>
        </Tooltip>
    );
}
