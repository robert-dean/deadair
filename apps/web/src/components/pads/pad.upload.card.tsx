import { useState } from 'react';
import { ActionIcon, Autocomplete, Badge, Button, Card, Group, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconTrash, IconUpload, IconVolume, IconX } from '@tabler/icons-react';
import type { PadSet } from '@deadair/sdk';

import { useUploadPad } from '../../api/pads.queries';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';

/**
 * The other door onto the rack: audio dragged into the browser.
 *
 * The disk is still the library — the file this writes lands in `media/pads/<board>/`, because the
 * content store is rewritten from that directory on every boot scan and an archive carries it — so
 * this is a second way IN rather than a second place things live. Which is why there is no mode
 * switch anywhere on the page: a sound dropped here and a sound dropped in the folder are the same
 * sound afterwards.
 *
 * ## Nothing is sent until the token is shown
 *
 * `[sfx:<name>]` is the entire interface between an operator and a model, and it is derived from the
 * filename by a rule (lower-cased, punctuation collapsed) that nobody would guess from looking at a
 * file called `Air Horn (2).wav`. So a file waits here as a staged row with its derived token visible
 * and editable, and Upload is a second, deliberate click. The alternative — dropping and hoping — is
 * how a rack ends up with `air-horn-2` and `airhorn-final-final` on it.
 */
export function PadUploadCard({ sets }: { sets: PadSet[] }) {
    const upload = useUploadPad();
    const [board, setBoard] = useState(DEFAULT_BOARD);
    const [staged, setStaged] = useState<Staged[]>([]);

    const stage = (files: File[]) =>
        setStaged(held => [...held, ...files.map(file => ({ file, name: tokenOf(file.name), label: labelOf(file.name) }))]);

    const send = async () => {
        // One at a time and in order, rather than a fan-out: each answers with the whole rack, so
        // parallel uploads would have several answers racing to be the one the cache keeps. A
        // soundboard is a handful of files.
        for (const one of staged) {
            const body = new FormData();
            body.append('board', board);
            body.append('name', one.name);
            body.append('label', one.label);
            body.append('file', one.file);

            await upload.mutateAsync(body);
        }

        setStaged([]);
    };

    return (
        <Card withBorder padding="md">
            <Stack gap="sm">
                <Eyebrow>Add sounds</Eyebrow>

                {upload.isError ? <ErrorAlert title="That sound did not go on the rack" error={upload.error} /> : undefined}

                <Group align="flex-end" gap="sm">
                    <Autocomplete
                        label="Board"
                        description="The folder it is filed under, which is also the set it joins. A new name makes both."
                        data={sets.map(set => set.key)}
                        value={board}
                        onChange={setBoard}
                        style={{ flex: '0 0 16rem' }}
                    />
                </Group>

                <Dropzone
                    onDrop={stage}
                    accept={ACCEPTED}
                    maxSize={MAX_BYTES}
                    // The server refuses the same things and says why; this only keeps an obvious
                    // mistake from becoming a round trip.
                    loading={upload.isPending}
                >
                    <Group justify="center" gap="md" mih={90} style={{ pointerEvents: 'none' }}>
                        <Dropzone.Accept>
                            <IconUpload size={32} />
                        </Dropzone.Accept>
                        <Dropzone.Reject>
                            <IconX size={32} />
                        </Dropzone.Reject>
                        <Dropzone.Idle>
                            <IconVolume size={32} />
                        </Dropzone.Idle>
                        <Stack gap={2}>
                            <Text size="sm">Drop audio here, or click to choose</Text>
                            <Text size="xs" c="dimmed">
                                mp3, wav, ogg, flac or m4a, up to 25 MB each. The file is written into the pad library on disk, so a backup carries
                                it.
                            </Text>
                        </Stack>
                    </Group>
                </Dropzone>

                {staged.length === 0 ? undefined : (
                    <>
                        <Table verticalSpacing="xs">
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>File</Table.Th>
                                    <Table.Th>What a script will write</Table.Th>
                                    <Table.Th>Name</Table.Th>
                                    <Table.Th />
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {staged.map((one, index) => (
                                    <Table.Tr key={`${one.file.name}-${index}`}>
                                        <Table.Td>
                                            <Text size="xs" c="dimmed">
                                                {one.file.name}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Group gap="xs" wrap="nowrap">
                                                <Badge
                                                    variant="light"
                                                    color="grape"
                                                    styles={{ label: { fontFamily: 'var(--mantine-font-family-monospace)', textTransform: 'none' } }}
                                                >
                                                    [sfx:{one.name || '…'}]
                                                </Badge>
                                                <TextInput
                                                    size="xs"
                                                    aria-label={`Name for ${one.file.name}`}
                                                    value={one.name}
                                                    onChange={event => amend(setStaged, index, { name: tokenOf(event.currentTarget.value) })}
                                                />
                                            </Group>
                                        </Table.Td>
                                        <Table.Td>
                                            <TextInput
                                                size="xs"
                                                aria-label={`Label for ${one.file.name}`}
                                                value={one.label}
                                                onChange={event => amend(setStaged, index, { label: event.currentTarget.value })}
                                            />
                                        </Table.Td>
                                        <Table.Td>
                                            <Tooltip label="Take it off the list">
                                                <ActionIcon
                                                    variant="subtle"
                                                    color="red"
                                                    aria-label={`Discard ${one.file.name}`}
                                                    onClick={() => setStaged(held => held.filter((_, at) => at !== index))}
                                                >
                                                    <IconTrash size={16} />
                                                </ActionIcon>
                                            </Tooltip>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>

                        <Group justify="flex-end">
                            <Button variant="default" onClick={() => setStaged([])} disabled={upload.isPending}>
                                Clear
                            </Button>
                            <Button
                                leftSection={<IconUpload size={16} />}
                                loading={upload.isPending}
                                disabled={staged.some(one => one.name === '')}
                                onClick={() => void send()}
                            >
                                Put {staged.length === 1 ? 'it' : `all ${staged.length}`} on the {board} board
                            </Button>
                        </Group>
                    </>
                )}
            </Stack>
        </Card>
    );
}

/** One file waiting to be sent, with what it will be called when it lands. */
interface Staged {
    file: File;
    name: string;
    label: string;
}

/** Where a sound goes when nobody says otherwise. `PadLibrary`'s own default board. */
const DEFAULT_BOARD = 'station';

/** What the store serves, as the dropzone's filter. Kept in step with `SEGMENT_CONTENT_TYPES`. */
const ACCEPTED = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/x-m4a'];

/** `MAX_PAD_BYTES`, which the server enforces. Here so an obvious mistake is not a round trip. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * A filename as the token a script writes.
 *
 * `padNameOf` on the server, by hand: this has to agree with it, because what the operator is shown
 * before they click is a promise about what the station will hold afterwards. The server is still
 * the authority — it normalises whatever arrives — so a drift here shows up as a surprise rather
 * than as a broken pad.
 */
function tokenOf(filename: string): string {
    const stem = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;

    return stem
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** A filename as something a person reads. `labelFor` on the server, by hand and for the same reason. */
function labelOf(filename: string): string {
    const stem = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;

    return stem.replace(/[-_]+/g, ' ').trim() || stem;
}

/** Change one staged row, leaving the rest alone. */
function amend(set: (update: (held: Staged[]) => Staged[]) => void, index: number, change: Partial<Staged>): void {
    set(held => held.map((one, at) => (at === index ? { ...one, ...change } : one)));
}
