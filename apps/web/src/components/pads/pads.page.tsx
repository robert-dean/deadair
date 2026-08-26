import { useState } from 'react';
import { ActionIcon, Badge, Button, Card, Checkbox, Group, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import {
    IconCheck,
    IconDownload,
    IconPencil,
    IconPlayerPauseFilled,
    IconPlayerPlay,
    IconPlus,
    IconRefresh,
    IconRotate,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import type { Pad, PadSet } from '@deadair/sdk';

import {
    fetchPadAudio,
    useCreatePadSet,
    useDeletePad,
    useDeletePadSet,
    usePads,
    useScanPads,
    useSetPadMembership,
    useSetPadState,
    useUpdatePadSet,
} from '../../api/pads.queries';
import { useVoicePreview } from '../voices/voice.preview';
import { PadUploadCard } from './pad.upload.card';
import { ConfirmModal } from '../shared/confirm.modal';
import { FeedMoment } from '../shared/dated.feed';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';

/**
 * The soundboard: the short sounds a presenter reaches for.
 *
 * ## There is no add button for a SOUND, and that is the design
 *
 * ## Two doors, one library
 *
 * A pad arrives by being dropped in `media/pads/<board>/`, which is how the station already takes
 * delivery of audio, or by being uploaded here — and both end in the same place, because the upload
 * writes a file into that same directory. That is not a nicety: the content store is rewritten from
 * the directory on every boot scan and an archive carries the directory, so a sound that lived only
 * in the store would be missing from every backup with nothing saying so.
 *
 * Rejecting is a state rather than a deletion because the scan re-reads that directory: a deleted
 * row is back on the next pass, and the operator's decision has to outlive it.
 *
 * ## A SET is the thing this page is actually for
 *
 * The library is flat and a set is what reaches into it — `personas.soundboard` names one, and a pad
 * can be on several. Dropping files in a folder makes the set named after it, so an operator who
 * never opens this page still has a working rack; what this adds is cutting one library more than
 * one way, which a folder cannot do.
 *
 * The columns are pads down and sets across, because the question an operator has is "which of these
 * can the late show reach" and a tick box answers it in one glance where two lists do not.
 */
export function PadsPage() {
    const rack = usePads();
    const scan = useScanPads();
    const setState = useSetPadState();
    const membership = useSetPadMembership();
    const createSet = useCreatePadSet();

    // The console's own preview, rather than an `<audio>` element built here. Every other page that
    // plays station audio goes through this, and a second way of doing it is a second set of bugs
    // about what happens when you click the next one before the first has finished.
    const preview = useVoicePreview();
    const remove = useDeletePad();
    const [newSet, setNewSet] = useState('');
    const [deleting, setDeleting] = useState<Pad | undefined>(undefined);

    if (rack.isPending) return <PageSkeleton variant="rows" count={6} />;
    if (rack.isError) return <ErrorAlert title="The soundboard could not be read" error={rack.error} />;

    const pads = rack.data?.pads ?? [];
    const sets = rack.data?.sets ?? [];
    const active = pads.filter(pad => pad.state === 'active');
    const rejected = pads.filter(pad => pad.state === 'rejected');

    const addSet = async () => {
        const key = newSet.trim();
        if (key.length === 0) return;

        await createSet.mutateAsync({ key, label: key });
        setNewSet('');
    };

    return (
        <Stack gap="lg">
            <PageHeader
                eyebrow="Station"
                title="Soundboard"
                description="The sounds a presenter reaches for, and the sets that decide who reaches which. Drop audio in below, or into the pad library on disk and re-scan; a persona points at a set by name."
                actions={
                    <Button leftSection={<IconRefresh size={16} />} variant="default" loading={scan.isPending} onClick={() => void scan.mutateAsync()}>
                        Re-scan the library
                    </Button>
                }
            />

            {scan.isError ? <ErrorAlert title="The pad library could not be read" error={scan.error} /> : undefined}
            {membership.isError ? <ErrorAlert title="That sound could not go on that set" error={membership.error} /> : undefined}
            {scan.isSuccess ? <ScanResult result={scan.data} /> : undefined}

            <PadUploadCard sets={sets} />

            <SetList sets={sets} value={newSet} onChange={setNewSet} onAdd={addSet} adding={createSet.isPending} />

            {active.length === 0 ? (
                <EmptyState title="Nothing on the rack">
                    Drop an mp3 or a wav above, or put one in the pad library on disk and re-scan. The name becomes what a script writes, so{' '}
                    <code>airhorn.mp3</code> is <code>[sfx:airhorn]</code>, and the board becomes a set a persona can point at.
                </EmptyState>
            ) : (
                <Card withBorder padding="md">
                    <Stack gap="sm">
                        <Eyebrow>The library</Eyebrow>
                        <PadTable
                            pads={active}
                            sets={sets}
                            preview={preview}
                            onToggle={(setId, padId, on) => void membership.mutateAsync({ id: setId, body: { padId, on } })}
                            onReject={id => void setState.mutateAsync({ id, body: { state: 'rejected' } })}
                            onDelete={setDeleting}
                        />
                    </Stack>
                </Card>
            )}

            {rejected.length > 0 ? (
                <Card withBorder padding="md">
                    <Stack gap="sm">
                        <Eyebrow>Turned down</Eyebrow>
                        <Text size="xs" c="dimmed">
                            Kept rather than deleted, because the scan re-reads the library: a row that was removed would be back on the next pass. A
                            turned-down sound stays on its sets and reserves nothing — put it back and it is reachable again.
                        </Text>
                        <PadTable
                            pads={rejected}
                            sets={[]}
                            preview={preview}
                            onRestore={id => void setState.mutateAsync({ id, body: { state: 'active' } })}
                            onDelete={setDeleting}
                        />
                    </Stack>
                </Card>
            ) : undefined}

            <ConfirmModal
                opened={deleting !== undefined}
                title={`Delete ${deleting?.label ?? ''}?`}
                confirmLabel="Delete the sound"
                onConfirm={async () => {
                    if (deleting !== undefined) await remove.mutateAsync(deleting.id);
                    setDeleting(undefined);
                }}
                onClose={() => setDeleting(undefined)}
            >
                The file this console wrote for it goes too, so the next scan does not read it back
                in. Any script already written naming <code>[sfx:{deleting?.name}]</code> will simply
                find nothing and be spoken without it.
            </ConfirmModal>
        </Stack>
    );
}

/**
 * The sets, and the one place a rename says what it is about to break.
 *
 * `personas.soundboard` holds a KEY rather than a foreign key, so nothing in the schema notices a
 * rename — every persona naming the old one silently stops finding it. That is why each row carries
 * who is pointed at it, and why the rename control says so rather than the delete one: deleting a set
 * takes the grouping and leaves every sound, where renaming quietly unpoints a character.
 */
function SetList({
    sets,
    value,
    onChange,
    onAdd,
    adding,
}: {
    sets: PadSet[];
    value: string;
    onChange: (value: string) => void;
    onAdd: () => void;
    adding: boolean;
}) {
    const update = useUpdatePadSet();
    const remove = useDeletePadSet();
    const [editing, setEditing] = useState<{ id: string; key: string } | undefined>(undefined);
    const [deleting, setDeleting] = useState<PadSet | undefined>(undefined);

    const save = async () => {
        if (editing === undefined || editing.key.trim().length === 0) return;

        await update.mutateAsync({ id: editing.id, body: { key: editing.key.trim(), label: editing.key.trim() } });
        setEditing(undefined);
    };

    return (
        <Card withBorder padding="md">
            <Stack gap="sm">
                <Eyebrow>Sets</Eyebrow>
                <Text size="xs" c="dimmed">
                    A persona points at one of these by name. A folder in the library makes one automatically; these are for cutting that library a
                    different way.
                </Text>

                {sets.length === 0 ? undefined : (
                    <Table verticalSpacing="xs">
                        <Table.Tbody>
                            {sets.map(set => (
                                <Table.Tr key={set.id}>
                                    <Table.Td>
                                        {editing?.id === set.id ? (
                                            <TextInput
                                                size="xs"
                                                value={editing.key}
                                                onChange={event => setEditing({ id: set.id, key: event.currentTarget.value })}
                                                onKeyDown={event => (event.key === 'Enter' ? void save() : undefined)}
                                            />
                                        ) : (
                                            <Badge variant="light" styles={{ label: { textTransform: 'none' } }}>
                                                {set.key}
                                            </Badge>
                                        )}
                                    </Table.Td>
                                    <Table.Td className="da-num">
                                        <Text size="sm" c="dimmed">
                                            {set.pads} {set.pads === 1 ? 'sound' : 'sounds'}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size="xs" c={set.personas.length === 0 ? 'dimmed' : undefined}>
                                            {set.personas.length === 0 ? 'nobody is pointed at it' : set.personas.join(', ')}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Group gap="xs" justify="flex-end" wrap="nowrap">
                                            {editing?.id === set.id ? (
                                                <>
                                                    <ActionIcon variant="subtle" aria-label="Save" onClick={() => void save()}>
                                                        <IconCheck size={16} />
                                                    </ActionIcon>
                                                    <ActionIcon variant="subtle" aria-label="Cancel" onClick={() => setEditing(undefined)}>
                                                        <IconX size={16} />
                                                    </ActionIcon>
                                                </>
                                            ) : (
                                                <>
                                                    <Tooltip
                                                        label={
                                                            set.personas.length === 0
                                                                ? 'Rename this set'
                                                                : `Renaming unpoints ${set.personas.join(', ')} — a persona names a set by its name`
                                                        }
                                                    >
                                                        <ActionIcon variant="subtle" aria-label={`Rename ${set.key}`} onClick={() => setEditing({ id: set.id, key: set.key })}>
                                                            <IconPencil size={16} />
                                                        </ActionIcon>
                                                    </Tooltip>
                                                    <Tooltip label="Remove the set. Every sound on it stays in the library.">
                                                        <ActionIcon variant="subtle" color="red" aria-label={`Delete ${set.key}`} onClick={() => setDeleting(set)}>
                                                            <IconTrash size={16} />
                                                        </ActionIcon>
                                                    </Tooltip>
                                                </>
                                            )}
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                )}

                <Group gap="xs">
                    <TextInput
                        size="xs"
                        placeholder="a name a persona can point at"
                        value={value}
                        onChange={event => onChange(event.currentTarget.value)}
                        onKeyDown={event => (event.key === 'Enter' ? onAdd() : undefined)}
                    />
                    <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} loading={adding} onClick={onAdd}>
                        Add a set
                    </Button>
                </Group>

                <ConfirmModal
                    opened={deleting !== undefined}
                    title={`Delete the ${deleting?.key ?? ''} set?`}
                    confirmLabel="Delete the set"
                    onConfirm={async () => {
                        if (deleting !== undefined) await remove.mutateAsync(deleting.id);
                        setDeleting(undefined);
                    }}
                    onClose={() => setDeleting(undefined)}
                >
                    Every sound on it stays in the library and on any other set.{' '}
                    {deleting !== undefined && deleting.personas.length > 0
                        ? `${deleting.personas.join(', ')} will be left with nothing to reach for.`
                        : 'Nobody is pointed at it.'}
                </ConfirmModal>
            </Stack>
        </Card>
    );
}

interface PadTableProps {
    pads: Pad[];
    sets: PadSet[];
    preview: ReturnType<typeof useVoicePreview>;
    onToggle?: (setId: string, padId: string, on: boolean) => void;
    onReject?: (id: string) => void;
    onRestore?: (id: string) => void;
    onDelete?: (pad: Pad) => void;
}

function PadTable({ pads, sets, preview, onToggle, onReject, onRestore, onDelete }: PadTableProps) {
    return (
        <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
                <Table.Tr>
                    <Table.Th>What a script writes</Table.Th>
                    <Table.Th>Name</Table.Th>
                    <Table.Th className="da-num">Length</Table.Th>
                    <Table.Th className="da-num">Loudness</Table.Th>
                    <Table.Th>Last hit</Table.Th>
                    {sets.map(set => (
                        <Table.Th key={set.id} style={{ textAlign: 'center' }}>
                            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                                {set.key}
                            </Text>
                        </Table.Th>
                    ))}
                    <Table.Th />
                </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
                {pads.map(pad => (
                    <Table.Tr key={pad.id}>
                        <Table.Td>
                            {/* Exactly as it has to be written, because this is the string a model is
                                offered and the only spelling the answer parser will find. */}
                            <Badge
                                variant="light"
                                color="grape"
                                // `tt: none` because a Badge upper-cases by default, and this column
                                // is titled "what a script writes": showing [SFX:RIMSHOT] for a token
                                // that is lower-case is the one thing this cell must not do.
                                styles={{ label: { fontFamily: 'var(--mantine-font-family-monospace)', textTransform: 'none' } }}
                            >
                                [sfx:{pad.name}]
                            </Badge>
                        </Table.Td>
                        <Table.Td>
                            <Text size="sm">{pad.label}</Text>
                            {pad.sourcePath ? (
                                <Text size="xs" c="dimmed">
                                    {pad.sourcePath}
                                </Text>
                            ) : undefined}
                        </Table.Td>
                        <Table.Td className="da-num">{pad.durationMs === undefined ? '—' : `${(pad.durationMs / 1000).toFixed(1)}s`}</Table.Td>
                        <Table.Td className="da-num">
                            {pad.loudnessLufs === undefined ? (
                                <Tooltip label="Nothing measured it. A sound under about half a second produces no loudness reading at all, which is most drops.">
                                    <Text size="sm" c="dimmed">
                                        —
                                    </Text>
                                </Tooltip>
                            ) : (
                                `${pad.loudnessLufs.toFixed(1)} LUFS`
                            )}
                        </Table.Td>
                        <Table.Td>
                            {/* The feed's own stamp rather than a second way of writing a time. A pad
                                nobody has reached for says so in words, because "—" here would read
                                as a value the station failed to record. */}
                            {pad.lastUsedAt === undefined ? (
                                <Text size="xs" c="dimmed">
                                    never
                                </Text>
                            ) : (
                                <FeedMoment at={pad.lastUsedAt} />
                            )}
                        </Table.Td>
                        {sets.map(set => (
                            <Table.Td key={set.id} style={{ textAlign: 'center' }}>
                                <Checkbox
                                    size="xs"
                                    checked={pad.sets.includes(set.key)}
                                    aria-label={`${pad.name} on ${set.key}`}
                                    onChange={event => onToggle?.(set.id, pad.id, event.currentTarget.checked)}
                                />
                            </Table.Td>
                        ))}
                        <Table.Td>
                            <Group gap="xs" justify="flex-end" wrap="nowrap">
                                <Tooltip label="Hear it">
                                    <ActionIcon
                                        variant="subtle"
                                        aria-label={`Play ${pad.label}`}
                                        loading={preview.isLoading(pad.id)}
                                        onClick={() => preview.play(pad.id, () => fetchPadAudio(pad.id), 'That pad would not play.')}
                                    >
                                        {preview.isPlaying(pad.id) ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlay size={16} />}
                                    </ActionIcon>
                                </Tooltip>
                                <Tooltip label="Download the file">
                                    <ActionIcon
                                        variant="subtle"
                                        aria-label={`Download ${pad.label}`}
                                        onClick={() => void download(pad)}
                                    >
                                        <IconDownload size={16} />
                                    </ActionIcon>
                                </Tooltip>
                                {onReject ? (
                                    <Tooltip label="Take it out of use. Kept, so the next scan does not put it back.">
                                        <ActionIcon variant="subtle" color="red" aria-label={`Reject ${pad.label}`} onClick={() => onReject(pad.id)}>
                                            <IconX size={16} />
                                        </ActionIcon>
                                    </Tooltip>
                                ) : undefined}
                                {onRestore ? (
                                    <Tooltip label="Put it back in use">
                                        <ActionIcon variant="subtle" aria-label={`Restore ${pad.label}`} onClick={() => onRestore(pad.id)}>
                                            <IconRotate size={16} />
                                        </ActionIcon>
                                    </Tooltip>
                                ) : undefined}
                                {/* Only for a file this console wrote. One the operator dropped in
                                    themselves is theirs, and deleting the row would only bring it
                                    back on the next scan; the reject above is the answer there. */}
                                {onDelete && pad.source !== 'library' ? (
                                    <Tooltip label="Delete it, and the file that was written for it">
                                        <ActionIcon variant="subtle" color="red" aria-label={`Delete ${pad.label}`} onClick={() => onDelete(pad)}>
                                            <IconTrash size={16} />
                                        </ActionIcon>
                                    </Tooltip>
                                ) : undefined}
                            </Group>
                        </Table.Td>
                    </Table.Tr>
                ))}
            </Table.Tbody>
        </Table>
    );
}

/**
 * Get one sound back off the station.
 *
 * Through the same blob URL the preview uses, because the audio route wants the console's bearer
 * token and a plain `<a href>` carries none. Named after the pad rather than after the file it
 * arrived as, since the name is what the station actually holds it under.
 *
 * Until `docs/todo/backup-and-restore.md` lands this is the only way out, which is why it is here at
 * all: a rack an operator can fill and not empty is a one-way door.
 */
async function download(pad: Pad): Promise<void> {
    const url = await fetchPadAudio(pad.id);

    const anchor = document.createElement('a');
    anchor.href = url;
    // The extension off the stored path, which is `<name>.<ext>` for anything this console wrote and
    // the operator's own filename for anything they dropped. `audioExt` is deliberately not on the
    // wire — see `toPadView` — so this is the honest source for it.
    anchor.download = `${pad.name}.${pad.sourcePath?.split('.').pop() ?? 'mp3'}`;
    anchor.click();

    // Released on the next turn rather than immediately: revoking in the same tick as the click
    // races the browser's own read of the blob, and a cancelled download looks like a broken button.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * What the last scan did, in a sentence.
 *
 * `replaced` and `contested` are called out separately from `imported` because each has a
 * consequence an operator might not expect: a replacement means every script that ever wrote that
 * name now plays a different sound, and a contested pad is in the library but on no set, so nothing
 * can reach it until somebody says where it goes.
 */
function ScanResult({ result }: { result: { scanned: number; imported: number; replaced: number; contested: number; skipped: number } }) {
    return (
        <Card withBorder padding="sm">
            <Text size="sm">
                Read {result.scanned} {result.scanned === 1 ? 'file' : 'files'}: {result.imported} new,{' '}
                {result.replaced > 0 ? (
                    <Text span fw={600}>
                        {result.replaced} replaced
                    </Text>
                ) : (
                    '0 replaced'
                )}
                , {result.skipped} passed over.
                {result.contested > 0 ? (
                    <Text span fw={600}>
                        {' '}
                        {result.contested} could not go on their set, because it already had a sound under that name — they are in the library and
                        nothing can reach them yet.
                    </Text>
                ) : undefined}
            </Text>
        </Card>
    );
}
