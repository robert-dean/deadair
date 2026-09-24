import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, FileButton, Group, List, Modal, ScrollArea, Stack, Table, Tabs, Text, TextInput, Textarea } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import type { PlaylistFile, PlaylistImportInput, PlaylistImportPlan } from '@deadair/sdk';

import { providerPlaylistPreviewOptions, useImportPlaylist, usePreviewPlaylistImport } from '../../api/station.playlists.queries';
import { ErrorAlert } from '../shared/error.alert';
import { PageSkeleton } from '../shared/page.skeleton';
import { usePhone } from '../shared/use.phone';

export interface PlaylistImportModalProps {
    opened: boolean;
    onClose: () => void;
    /**
     * A playlist a music source lists here, to clone rather than choosing a source: the provider
     * playlist page's "Save as a station playlist". The dialog opens straight onto its preview.
     */
    from?: { pluginId: string; playlistId: string; name: string };
}

/** The files a playlist arrives in: deadair's own JSON, and the text other software writes. */
const ACCEPTED = '.json,.m3u,.m3u8,.csv,.tsv,.txt,application/json,text/csv,text/plain,audio/x-mpegurl,audio/mpegurl';

/**
 * Making a station playlist from somewhere else.
 *
 * Choose, read what it would do, do it: the persona import's three steps in one dialog, for its
 * reasons. The plan on screen is the decision rather than a forecast, because the import runs the
 * same planner on the same source.
 *
 * A `.json` file is parsed HERE only as far as knowing it is JSON, so one that is not gets a plain
 * sentence rather than a 400 from a schema that never ran. Anything else is sent as text, and the
 * API reads it as an M3U, a CSV or a list of `Artist - Title` lines.
 */
export function PlaylistImportModal({ opened, onClose, from }: PlaylistImportModalProps) {
    const phone = usePhone();
    const navigate = useNavigate();
    const preview = usePreviewPlaylistImport();
    const write = useImportPlaylist();
    // A playlist named by the page that opened this has nothing to choose, so its preview is a READ
    // of that playlist rather than a step the operator takes: a query, run while the dialog is open.
    const fromPreview = useQuery({
        ...providerPlaylistPreviewOptions(from?.pluginId ?? '', from?.playlistId ?? ''),
        enabled: opened && from !== undefined,
    });

    // The source as it was previewed, so Import sends exactly that rather than re-reading a file the
    // operator may have replaced on disk in between, or a paste they have since edited.
    const [chosen, setChosen] = useState<PlaylistImportInput | undefined>(undefined);
    const [fileName, setFileName] = useState<string | undefined>(undefined);
    const [pasted, setPasted] = useState('');
    const [link, setLink] = useState('');
    // Only what the operator typed. Until they type, the name is whatever the source gave it.
    const [edited, setEdited] = useState<string | undefined>(undefined);
    const [unreadable, setUnreadable] = useState<string | undefined>(undefined);

    const source: PlaylistImportInput | undefined =
        from === undefined ? chosen : { providerPlaylist: { pluginId: from.pluginId, playlistId: from.playlistId } };
    const plan = from === undefined ? preview.data : fromPreview.data;
    const previewError = from === undefined ? preview.error : fromPreview.error;
    const name = edited ?? from?.name ?? plan?.name ?? '';

    const restart = () => {
        setChosen(undefined);
        setEdited(undefined);
        setUnreadable(undefined);
        preview.reset();
        write.reset();
    };

    const close = () => {
        restart();
        setFileName(undefined);
        setPasted('');
        setLink('');
        onClose();
    };

    const read = (input: PlaylistImportInput) => {
        setChosen(input);
        preview.mutate(input);
    };

    const choose = async (chosen: File | null) => {
        if (chosen === null) return;

        restart();
        setFileName(chosen.name);
        const text = await chosen.text();

        if (!chosen.name.toLowerCase().endsWith('.json')) {
            read({ text, fileName: chosen.name });
            return;
        }

        let file: PlaylistFile;
        try {
            file = JSON.parse(text) as PlaylistFile;
        } catch {
            setUnreadable(`"${chosen.name}" is not a file this can read. A playlist file is the JSON a station playlist's Export saved.`);
            return;
        }
        read({ file });
    };

    const trimmed = name.trim();

    const submit = () => {
        if (source === undefined) return;
        write.mutate(
            { ...source, ...(trimmed.length === 0 ? {} : { name: trimmed }) },
            {
                onSuccess: result => {
                    close();
                    void navigate({ to: '/station-playlists/$id', params: { id: result.playlist.id } });
                },
            },
        );
    };

    return (
        <Modal opened={opened} onClose={close} title="Import a playlist" size="lg" fullScreen={phone}>
            <Stack gap="md">
                <Text size="sm" c="dimmed">
                    It becomes a new playlist of the station&apos;s own: importing the same thing twice makes two. A record the library does not hold
                    keeps its place, and the station looks it up at its music sources straight after the import.
                </Text>

                {from === undefined ? (
                    <Tabs defaultValue="file" onChange={restart}>
                        <Tabs.List>
                            <Tabs.Tab value="file">File</Tabs.Tab>
                            <Tabs.Tab value="paste">Paste a list</Tabs.Tab>
                            <Tabs.Tab value="link">Link</Tabs.Tab>
                        </Tabs.List>

                        <Tabs.Panel value="file" pt="md">
                            <Stack gap="xs">
                                <Text size="xs" c="dimmed">
                                    A playlist file another station exported, an M3U from a media player, or a CSV from a playlist exporter.
                                </Text>
                                <Group gap="sm">
                                    <FileButton onChange={file => void choose(file)} accept={ACCEPTED}>
                                        {props => (
                                            <Button {...props} variant="default" loading={preview.isPending && source?.text === undefined}>
                                                {fileName === undefined ? 'Choose a file' : 'Choose another file'}
                                            </Button>
                                        )}
                                    </FileButton>
                                    {fileName === undefined ? undefined : (
                                        <Text size="sm" c="dimmed">
                                            {fileName}
                                        </Text>
                                    )}
                                </Group>
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel value="paste" pt="md">
                            <Stack gap="xs">
                                <Textarea
                                    label="One record per line"
                                    description="As Artist - Title. Numbered lines are fine."
                                    placeholder={'Massive Attack - Teardrop\nPortishead - Roads'}
                                    value={pasted}
                                    onChange={event => setPasted(event.currentTarget.value)}
                                    autosize
                                    minRows={4}
                                    maxRows={12}
                                />
                                <Group justify="flex-end">
                                    <Button
                                        variant="default"
                                        disabled={pasted.trim().length === 0}
                                        loading={preview.isPending}
                                        onClick={() => read({ text: pasted })}
                                    >
                                        Preview
                                    </Button>
                                </Group>
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel value="link" pt="md">
                            <Stack gap="xs">
                                <TextInput
                                    label="Playlist link"
                                    description="Copied from Spotify, YouTube Music or your Navidrome, as the browser or the app shows it."
                                    placeholder="https://open.spotify.com/playlist/…"
                                    value={link}
                                    onChange={event => setLink(event.currentTarget.value)}
                                />
                                <Group justify="flex-end">
                                    <Button
                                        variant="default"
                                        disabled={link.trim().length === 0}
                                        loading={preview.isPending}
                                        onClick={() => read({ url: link.trim() })}
                                    >
                                        Preview
                                    </Button>
                                </Group>
                            </Stack>
                        </Tabs.Panel>
                    </Tabs>
                ) : (
                    <Text size="sm">{`Saving ${from.name} as a playlist of the station's own.`}</Text>
                )}

                {unreadable ? <ErrorAlert tone="warning">{unreadable}</ErrorAlert> : undefined}

                {previewError ? (
                    <ErrorAlert title="That could not be read" error={previewError} fallback="It is not a playlist this station recognises." />
                ) : undefined}

                {from !== undefined && fromPreview.isPending ? <PageSkeleton variant="table" /> : undefined}

                {write.error ? (
                    <ErrorAlert
                        title="Nothing was imported"
                        error={write.error}
                        fallback="The station is exactly as it was: an import that fails is undone in full."
                    />
                ) : undefined}

                {plan ? (
                    <>
                        <TextInput label="Name" value={name} onChange={event => setEdited(event.currentTarget.value)} maxLength={200} />
                        <ImportPlan plan={plan} />
                        <Group justify="flex-end">
                            <Button variant="subtle" onClick={close}>
                                Cancel
                            </Button>
                            <Button loading={write.isPending} disabled={plan.entries.length === 0} onClick={submit}>
                                {`Import ${count(plan.entries.length, 'record', 'records')}`}
                            </Button>
                        </Group>
                    </>
                ) : undefined}
            </Stack>
        </Modal>
    );
}

/** What each record would become, with the totals said once above the list. */
function ImportPlan({ plan }: { plan: PlaylistImportPlan }) {
    const waiting = plan.toAdd + plan.toLookUp;

    return (
        <Stack gap="sm">
            <Text size="sm">
                {count(plan.matched, 'record is', 'records are')} in the library
                {waiting > 0
                    ? `, and ${count(waiting, 'is', 'are')} not: the station looks ${waiting === 1 ? 'it' : 'them'} up once the playlist is made`
                    : ''}
                .
            </Text>

            {plan.notices.length > 0 ? (
                <List size="xs" spacing={2}>
                    {plan.notices.map(notice => (
                        <List.Item key={notice}>
                            <Text size="xs" c="dimmed" span>
                                {notice}
                            </Text>
                        </List.Item>
                    ))}
                </List>
            ) : undefined}

            {plan.entries.length > 0 ? (
                <ScrollArea.Autosize mah={320}>
                    <Table verticalSpacing="xs">
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Record</Table.Th>
                                <Table.Th w={140}>Lands as</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {plan.entries.map(entry => (
                                <Table.Tr key={entry.position}>
                                    <Table.Td>
                                        <Text size="sm" lineClamp={1}>
                                            {entry.title}
                                        </Text>
                                        <Text size="xs" c="dimmed" lineClamp={1}>
                                            {entry.artists.join(', ')}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        {entry.outcome === 'matched' ? (
                                            <Badge size="sm" variant="light" color="teal">
                                                In the library
                                            </Badge>
                                        ) : (
                                            <Badge size="sm" variant="light" color="gray">
                                                To look up
                                            </Badge>
                                        )}
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </ScrollArea.Autosize>
            ) : undefined}
        </Stack>
    );
}

const count = (many: number, one: string, several: string): string => `${many} ${many === 1 ? one : several}`;
