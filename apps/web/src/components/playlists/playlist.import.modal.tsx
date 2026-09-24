import { useState } from 'react';
import { Badge, Button, FileButton, Group, List, Modal, ScrollArea, Stack, Table, Text, TextInput } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import type { PlaylistFile, PlaylistImportInput, PlaylistImportPlan } from '@deadair/sdk';

import { useImportPlaylist, usePreviewPlaylistImport } from '../../api/station.playlists.queries';
import { ErrorAlert } from '../shared/error.alert';
import { usePhone } from '../shared/use.phone';

export interface PlaylistImportModalProps {
    opened: boolean;
    onClose: () => void;
}

/**
 * Making a station playlist from a file.
 *
 * Choose, read what it would do, do it: the persona import's three steps in one dialog, for its
 * reasons. The plan on screen is the decision rather than a forecast, because the import runs the
 * same planner on the same source.
 *
 * The source is parsed HERE only as far as knowing it is JSON, so a file that is not gets a plain
 * sentence rather than a 400 from a schema that never ran. Everything else is the API's to judge.
 */
export function PlaylistImportModal({ opened, onClose }: PlaylistImportModalProps) {
    const phone = usePhone();
    const navigate = useNavigate();
    const preview = usePreviewPlaylistImport();
    const write = useImportPlaylist();

    // The source as it was previewed, so Import sends exactly that rather than re-reading a file the
    // operator may have replaced on disk in between.
    const [source, setSource] = useState<PlaylistImportInput | undefined>(undefined);
    const [fileName, setFileName] = useState<string | undefined>(undefined);
    const [name, setName] = useState('');
    const [unreadable, setUnreadable] = useState<string | undefined>(undefined);

    const close = () => {
        setSource(undefined);
        setFileName(undefined);
        setName('');
        setUnreadable(undefined);
        preview.reset();
        write.reset();
        onClose();
    };

    const choose = async (chosen: File | null) => {
        if (chosen === null) return;

        setUnreadable(undefined);
        preview.reset();
        write.reset();
        setFileName(chosen.name);

        let file: PlaylistFile;
        try {
            file = JSON.parse(await chosen.text()) as PlaylistFile;
        } catch {
            setSource(undefined);
            setUnreadable(`"${chosen.name}" is not a file this can read. A playlist file is the JSON a station playlist's Export saved.`);
            return;
        }

        const input: PlaylistImportInput = { file };
        setSource(input);
        preview.mutate(input, { onSuccess: plan => setName(plan.name) });
    };

    const plan = preview.data;
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
                    A playlist file saved by this station or somebody else&apos;s. It becomes a new playlist of the station&apos;s own: importing the
                    same file twice makes two. A record the library does not hold keeps its place, and the station looks it up at its music sources
                    straight after the import.
                </Text>

                <Group gap="sm">
                    <FileButton onChange={file => void choose(file)} accept="application/json,.json">
                        {props => (
                            <Button {...props} variant="default" loading={preview.isPending}>
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

                {unreadable ? <ErrorAlert tone="warning">{unreadable}</ErrorAlert> : undefined}

                {preview.error ? (
                    <ErrorAlert
                        title="That file could not be read"
                        error={preview.error}
                        fallback="It is JSON, but not a playlist file this station recognises."
                    />
                ) : undefined}

                {write.error ? (
                    <ErrorAlert
                        title="Nothing was imported"
                        error={write.error}
                        fallback="The station is exactly as it was: an import that fails is undone in full."
                    />
                ) : undefined}

                {plan ? (
                    <>
                        <TextInput label="Name" value={name} onChange={event => setName(event.currentTarget.value)} maxLength={200} />
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
                .{plan.skipped > 0 ? ` ${count(plan.skipped, 'line', 'lines')} named no record and will be left out.` : ''}
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
