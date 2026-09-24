import { useState } from 'react';
import { Anchor, Badge, Button, Group, Modal, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { StationPlaylistDetail, StationPlaylistTrack } from '@deadair/sdk';

import {
    exportStationPlaylist,
    stationPlaylistOptions,
    useDeleteStationPlaylist,
    useFillStationPlaylist,
    useUpdateStationPlaylist,
} from '../../api/station.playlists.queries';
import { PlayStationPlaylistButton } from '../playout/play.playlist.button';
import { AlbumLink, ArtistLink, TrackLink } from '../shared/catalog.links';
import { ConfirmModal } from '../shared/confirm.modal';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { formatDuration } from '../shared/format.duration';
import { notifyQueued } from '../shared/notify';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { PhoneCard } from '../shared/phone.card';
import { usePhone } from '../shared/use.phone';
import { holdingLine, usePluginName } from './station.playlist.card';

/**
 * One playlist the station owns, record by record.
 *
 * A placeholder is drawn in its place, dimmed and labelled, rather than left out: it is a record the
 * playlist names and the library does not hold yet, and a list that silently skipped it would read
 * as a shorter playlist than the one that was imported.
 */
export function StationPlaylistPage({ id }: { id: string }) {
    const playlist = useQuery(stationPlaylistOptions(id));
    const origin = usePluginName(playlist.data?.originPluginId);
    const phone = usePhone();
    const navigate = useNavigate();
    const remove = useDeleteStationPlaylist();
    const fill = useFillStationPlaylist();
    const [editing, setEditing] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportFailure, setExportFailure] = useState<unknown>(undefined);

    const save = async () => {
        setExporting(true);
        setExportFailure(undefined);
        try {
            await exportStationPlaylist(id);
        } catch (error) {
            setExportFailure(error);
        } finally {
            setExporting(false);
        }
    };

    const data = playlist.data;
    const tracks = data?.tracks ?? [];

    return (
        <Stack gap="lg">
            <Stack gap="xxs">
                <Anchor renderRoot={(props: object) => <Link to="/playlists" {...props} />} size="sm">
                    Back to playlists
                </Anchor>
                <PageHeader
                    title={data?.name ?? 'Playlist'}
                    description={
                        data ? (
                            <Text c="dimmed" size="sm">
                                {origin === undefined ? 'The station’s own' : `The station’s own, cloned from ${origin}`}
                                {` • ${holdingLine(data)}`}
                            </Text>
                        ) : undefined
                    }
                    actions={
                        data ? (
                            <Group gap="xs">
                                {/* Only when something on it can air: a playlist of nothing but
                                    placeholders is refused with a 422, so offering the button first
                                    invites it. */}
                                {data.resolvedCount > 0 ? <PlayStationPlaylistButton stationPlaylistId={id} size="xs" /> : undefined}
                                {data.resolvedCount < data.trackCount ? (
                                    <Button
                                        size="xs"
                                        variant="default"
                                        loading={fill.isPending}
                                        onClick={() =>
                                            fill.mutate(id, {
                                                onSuccess: () =>
                                                    notifyQueued(
                                                        `The station is looking up the records missing from ${data.name}. The activity feed says how many it found.`,
                                                    ),
                                            })
                                        }
                                    >
                                        Look up missing records
                                    </Button>
                                ) : undefined}
                                <Button size="xs" variant="default" loading={exporting} onClick={() => void save()}>
                                    Export
                                </Button>
                                <Button size="xs" variant="default" onClick={() => setEditing(true)}>
                                    Rename
                                </Button>
                                <Button size="xs" variant="subtle" color="red" onClick={() => setDeleting(true)}>
                                    Delete
                                </Button>
                            </Group>
                        ) : undefined
                    }
                />
            </Stack>

            {exportFailure ? <ErrorAlert title="The playlist could not be exported" error={exportFailure} /> : undefined}

            {fill.error ? <ErrorAlert title="The missing records could not be looked up" error={fill.error} /> : undefined}

            {playlist.error ? (
                <ErrorAlert title="This playlist could not be loaded" error={playlist.error} fallback="It may have been deleted." />
            ) : undefined}

            {playlist.isPending ? <PageSkeleton variant="table" /> : undefined}

            {data?.prompt ? (
                <Text size="sm" c="dimmed">
                    {data.prompt}
                </Text>
            ) : undefined}

            {data && tracks.length === 0 ? <EmptyState>This playlist names no records.</EmptyState> : undefined}

            {phone && tracks.length > 0 ? (
                <Stack gap="xxs">
                    {tracks.map(track => (
                        <PhoneCard
                            key={track.id}
                            title={
                                <TrackLink id={track.trackId} size="sm" truncate c={held(track) ? undefined : 'dimmed'}>
                                    {track.title}
                                </TrackLink>
                            }
                            subtitle={
                                <ArtistLink id={track.artistId} size="xs" c="dimmed" truncate>
                                    {track.artists.join(', ')}
                                </ArtistLink>
                            }
                            figure={held(track) ? formatDuration(track.durationMs) : <Waiting />}
                        />
                    ))}
                </Stack>
            ) : undefined}

            {!phone && tracks.length > 0 ? (
                <Table.ScrollContainer minWidth={600}>
                    <Table>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th w={48}>#</Table.Th>
                                <Table.Th>Title</Table.Th>
                                <Table.Th>Artists</Table.Th>
                                <Table.Th>Album</Table.Th>
                                <Table.Th>Duration</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {tracks.map(track => (
                                <Table.Tr key={track.id} c={held(track) ? undefined : 'dimmed'}>
                                    <Table.Td className="da-num">{track.position + 1}</Table.Td>
                                    <Table.Td>
                                        <Group gap="xs" wrap="nowrap">
                                            <TrackLink id={track.trackId}>{track.title}</TrackLink>
                                            {held(track) ? undefined : <Waiting />}
                                        </Group>
                                    </Table.Td>
                                    <Table.Td>
                                        <ArtistLink id={track.artistId}>{track.artists.join(', ')}</ArtistLink>
                                    </Table.Td>
                                    <Table.Td>
                                        <AlbumLink id={track.albumId}>{track.album ?? ''}</AlbumLink>
                                    </Table.Td>
                                    <Table.Td className="da-num">{formatDuration(track.durationMs)}</Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
            ) : undefined}

            {data ? <RenameModal playlist={data} opened={editing} onClose={() => setEditing(false)} /> : undefined}

            <ConfirmModal
                opened={deleting}
                onClose={() => {
                    setDeleting(false);
                    remove.reset();
                }}
                onConfirm={() => remove.mutate(id, { onSuccess: () => void navigate({ to: '/playlists' }) })}
                title={`Delete ${data?.name ?? 'this playlist'}?`}
                confirmLabel="Delete"
                confirming={remove.isPending}
                error={remove.error}
                errorTitle="The playlist could not be deleted"
            >
                The playlist goes. The records it named stay in the library.
            </ConfirmModal>
        </Stack>
    );
}

/** Whether a row names a record the library holds, which is what can air. */
const held = (track: StationPlaylistTrack): boolean => track.trackId !== undefined;

function Waiting() {
    return (
        <Badge size="xs" variant="outline" color="gray" tt="none">
            Not in the library
        </Badge>
    );
}

/** The name and what the playlist is for, the two things about it that are the operator's to change. */
function RenameModal({ playlist, opened, onClose }: { playlist: StationPlaylistDetail; opened: boolean; onClose: () => void }) {
    const update = useUpdateStationPlaylist();
    const [name, setName] = useState(playlist.name);
    const [prompt, setPrompt] = useState(playlist.prompt);

    const close = () => {
        update.reset();
        onClose();
    };

    return (
        <Modal opened={opened} onClose={close} title="Rename playlist" centered>
            <Stack gap="md">
                <TextInput label="Name" value={name} onChange={event => setName(event.currentTarget.value)} maxLength={200} />
                <Textarea
                    label="What it is for"
                    description="In your own words. Optional."
                    value={prompt}
                    onChange={event => setPrompt(event.currentTarget.value)}
                    maxLength={4000}
                    autosize
                    minRows={2}
                />
                {update.error ? <ErrorAlert title="Nothing was changed" error={update.error} /> : undefined}
                <Group justify="flex-end">
                    <Button variant="subtle" onClick={close}>
                        Cancel
                    </Button>
                    <Button
                        loading={update.isPending}
                        disabled={name.trim().length === 0}
                        onClick={() =>
                            update.mutate({ id: playlist.id, changes: { name: name.trim(), prompt: prompt.trim() } }, { onSuccess: close })
                        }
                    >
                        Save
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}
