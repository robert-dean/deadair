import { useState } from 'react';
import { ActionIcon, Alert, Autocomplete, Button, Card, Group, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconInfoCircle, IconTrash, IconUpload, IconVolume, IconX } from '@tabler/icons-react';

import { useUploadSegment } from '../../api/segments.queries';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';

/**
 * The other door into the library: audio dragged into the browser.
 *
 * The inbox is still where the file lands — this writes into it rather than around it — because the
 * content store is rewritten from that directory on every boot scan and an archive carries the
 * directory. So this is a second way IN, not a second place things live, and a recording uploaded
 * here is indistinguishable afterwards from one dropped in the folder.
 *
 * ## The kind is the part worth showing before it commits
 *
 * `readyKinds()` feeds the format clock, so a kind nothing else uses becomes an hour an operator can
 * schedule the station around the moment this segment is ready. A typo would make one in silence,
 * which is why an unfamiliar kind says so here rather than being discovered on the schedule page.
 *
 * The label matters for a different reason: it is what goes on the mount as the title while the
 * segment airs, so it reaches a listener's car stereo. Derived from the filename and editable.
 */
export function SegmentUploadCard({ kinds, onDone }: { kinds: string[]; onDone: () => void }) {
    const upload = useUploadSegment();
    const [kind, setKind] = useState(DEFAULT_KIND);
    const [staged, setStaged] = useState<Staged[]>([]);

    const stage = (files: File[]) => setStaged(held => [...held, ...files.map(file => ({ file, label: labelOf(file.name) }))]);

    const send = async () => {
        // One at a time and in order rather than a fan-out: the inbox disambiguates a name already
        // taken by counting up from it, and two uploads racing for the same name would both look at
        // the directory before either had written to it.
        for (const one of staged) {
            const body = new FormData();
            body.append('kind', kind);
            body.append('label', one.label);
            body.append('file', one.file);

            await upload.mutateAsync(body);
        }

        setStaged([]);
        onDone();
    };

    const unfamiliar = kind.trim() !== '' && !kinds.includes(kind.trim());

    return (
        <Card withBorder padding="md">
            <Stack gap="sm">
                <Eyebrow>Upload a recording</Eyebrow>

                {upload.isError ? <ErrorAlert title="That recording did not go into the library" error={upload.error} /> : undefined}

                <Group align="flex-start" gap="sm">
                    <Autocomplete
                        label="Kind"
                        description="What sort of element it is. It is also the folder the file is filed under."
                        data={kinds}
                        value={kind}
                        onChange={setKind}
                        style={{ flex: '0 0 16rem' }}
                    />
                    {unfamiliar ? (
                        <Alert variant="light" color="yellow" icon={<IconInfoCircle size={16} />} style={{ flex: 1 }}>
                            The station holds nothing of this kind yet, so <strong>{kind.trim()}</strong> will appear in the format clock as an hour
                            you can schedule around once this is ready.
                        </Alert>
                    ) : undefined}
                </Group>

                <Dropzone onDrop={stage} accept={ACCEPTED} maxSize={MAX_BYTES} loading={upload.isPending}>
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
                                mp3, wav, ogg, flac or m4a, up to 50 MB each. The file is written into the inbox folder, so a backup carries it and a
                                re-scan leaves it alone.
                            </Text>
                        </Stack>
                    </Group>
                </Dropzone>

                {staged.length === 0 ? undefined : (
                    <>
                        <Table.ScrollContainer minWidth={480}>
                            <Table verticalSpacing="xs">
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>File</Table.Th>
                                        <Table.Th>What it is called on air</Table.Th>
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
                                                <TextInput
                                                    size="xs"
                                                    aria-label={`Label for ${one.file.name}`}
                                                    value={one.label}
                                                    onChange={event =>
                                                        setStaged(held =>
                                                            held.map((row, at) =>
                                                                at === index ? { ...row, label: event.currentTarget.value } : row,
                                                            ),
                                                        )
                                                    }
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
                        </Table.ScrollContainer>

                        <Group justify="flex-end">
                            <Button variant="default" onClick={() => setStaged([])} disabled={upload.isPending}>
                                Clear
                            </Button>
                            <Button
                                leftSection={<IconUpload size={16} />}
                                loading={upload.isPending}
                                disabled={kind.trim() === '' || staged.some(one => one.label.trim() === '')}
                                onClick={() => void send()}
                            >
                                Put {staged.length === 1 ? 'it' : `all ${staged.length}`} in the library
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
    label: string;
}

/** What a recording is when nobody says. `SegmentLibrary`'s own default kind. */
const DEFAULT_KIND = 'ident';

/** What the store serves, as the dropzone's filter. Kept in step with `SEGMENT_CONTENT_TYPES`. */
const ACCEPTED = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/x-m4a'];

/** `MAX_SEGMENT_BYTES`, which the server enforces. Here so an obvious mistake is not a round trip. */
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * A filename as something a listener can read.
 *
 * `labelFor` on the server, by hand and for its reason: this ends up on the mount as the title while
 * the segment airs, and what the operator is shown before they click had better be what the station
 * will hold afterwards. The server still normalises whatever arrives, so a drift here shows up as a
 * surprise rather than as a broken segment.
 */
function labelOf(filename: string): string {
    const stem = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;

    return stem.replace(/[-_]+/g, ' ').trim() || stem;
}
