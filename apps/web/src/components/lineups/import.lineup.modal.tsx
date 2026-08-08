import { useState } from 'react';
import { Alert, Button, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { CatalogPlaylist, LineupMode, LineupOnEnd } from '@deadair/sdk';

import { useImportLineup } from '../../api/director.queries';
import { playlistsListOptions } from '../../api/playlists.queries';
import { apiErrorMessage } from '../../api/sdk.error';

export interface ImportLineupModalProps {
    opened: boolean;
    onClose: () => void;
}

/** The modes, with what each one means to the rules the lineup runs under. */
const MODES: { value: LineupMode; label: string }[] = [
    { value: 'rotation', label: 'Rotation — spaced by the station’s rules' },
    { value: 'setlist', label: 'Setlist — played in the order it holds' },
    { value: 'feature', label: 'Feature — one body of work, start to finish' },
];

/** What the station does when the lineup runs out. */
const ON_ENDS: { value: LineupOnEnd; label: string }[] = [
    { value: 'extend', label: 'Extend before it runs out' },
    { value: 'repeat', label: 'Start again from the top' },
    { value: 'resume', label: 'Hand back to whatever it interrupted' },
    { value: 'rotation', label: 'Fall back to the station’s rotation' },
    { value: 'stop', label: 'Stop the station' },
];

/**
 * One playlist as a select value.
 *
 * Both ids, because neither is unique on its own: two plugins can each hold a playlist called
 * `liked`. Encoded rather than joined with a separator, since a provider's playlist id is an opaque
 * string and any character chosen as a delimiter could appear inside one.
 */
const playlistValue = (playlist: CatalogPlaylist): string => JSON.stringify([playlist.pluginId, playlist.id]);

/** A playlist that cannot be read cannot be imported, for the same reason it cannot be aired. */
const canRead = (playlist: CatalogPlaylist): boolean => playlist.permissions?.includes('read') ?? true;

/**
 * Building a lineup from a provider playlist, without leaving the lineups page.
 *
 * Reads the same playlist list the Playlists page does, so an operator who has already been there
 * pays nothing for this. The mode and the ending are asked for here rather than defaulted silently:
 * they are the difference between a setlist and a rotation, and changing one after the fact is a
 * screen this console does not have yet.
 */
export function ImportLineupModal({ opened, onClose }: ImportLineupModalProps) {
    const navigate = useNavigate();
    const playlists = useQuery({ ...playlistsListOptions, enabled: opened });
    const importLineup = useImportLineup();

    const [selected, setSelected] = useState<string | undefined>(undefined);
    const [name, setName] = useState('');
    const [mode, setMode] = useState<LineupMode>('rotation');
    const [onEnd, setOnEnd] = useState<LineupOnEnd>('extend');

    const available = (playlists.data?.playlists ?? []).filter(canRead);
    const chosen = available.find(playlist => playlistValue(playlist) === selected);

    const failure = importLineup.isError ? apiErrorMessage(importLineup.error, 'That playlist could not be imported.') : undefined;

    /**
     * Shutting the modal, and forgetting what was in it.
     *
     * Cleared here rather than in an effect on `opened`: the close is the event, and reacting to
     * the flag afterwards would be a render that sets state. Without it, a second import opens
     * holding the first one's answers, including a failure that is no longer about anything.
     */
    function close(): void {
        setSelected(undefined);
        setName('');
        importLineup.reset();
        onClose();
    }

    return (
        <Modal opened={opened} onClose={close} title="Import a lineup" centered>
            <Stack gap="md">
                <Text size="sm" c="dimmed">
                    Copies a provider playlist into the station’s own programming. Nothing goes to air until the lineup is put on.
                </Text>

                {playlists.error ? (
                    <Alert color="red" title="Playlists could not be loaded">
                        {apiErrorMessage(playlists.error, 'The playlist catalogue is unavailable.')}
                    </Alert>
                ) : undefined}

                {failure ? (
                    <Alert color="red" title="Import failed">
                        {failure}
                    </Alert>
                ) : undefined}

                <Select
                    label="Playlist"
                    placeholder={playlists.isPending ? 'Loading…' : 'Choose a playlist'}
                    searchable
                    disabled={playlists.isPending}
                    data={available.map(playlist => ({
                        value: playlistValue(playlist),
                        label: `${playlist.name} — ${playlist.pluginName}${playlist.trackCount === undefined ? '' : ` (${playlist.trackCount})`}`,
                    }))}
                    value={selected ?? null}
                    onChange={value => {
                        setSelected(value ?? undefined);
                        const picked = available.find(playlist => playlistValue(playlist) === value);
                        setName(picked?.name ?? '');
                    }}
                />

                <TextInput
                    label="Name"
                    description="What the station calls this lineup."
                    value={name}
                    onChange={event => {
                        setName(event.currentTarget.value);
                    }}
                />

                <Select
                    label="Mode"
                    data={MODES}
                    value={mode}
                    allowDeselect={false}
                    onChange={value => {
                        if (value) setMode(value as LineupMode);
                    }}
                />

                <Select
                    label="When it runs out"
                    data={ON_ENDS}
                    value={onEnd}
                    allowDeselect={false}
                    onChange={value => {
                        if (value) setOnEnd(value as LineupOnEnd);
                    }}
                />

                <Group justify="flex-end">
                    <Button variant="default" onClick={close}>
                        Cancel
                    </Button>
                    <Button
                        loading={importLineup.isPending}
                        disabled={chosen === undefined}
                        onClick={() => {
                            if (!chosen) return;
                            importLineup.mutate(
                                {
                                    pluginId: chosen.pluginId,
                                    playlistId: chosen.id,
                                    // Blank falls back to the API's own naming rather than importing
                                    // a lineup called nothing.
                                    ...(name.trim() === '' ? {} : { name: name.trim() }),
                                    mode,
                                    onEnd,
                                },
                                {
                                    onSuccess: lineup => {
                                        close();
                                        void navigate({ to: '/lineups/$lineupId', params: { lineupId: lineup.id } });
                                    },
                                },
                            );
                        }}
                    >
                        Import
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}
