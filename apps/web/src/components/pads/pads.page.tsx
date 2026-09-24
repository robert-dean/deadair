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
import { Trans, useTranslation } from 'react-i18next';
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
import { PadUploadCard, sfxToken } from './pad.upload.card';
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
    const { t } = useTranslation('pads');
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
    if (rack.isError) return <ErrorAlert title={t('page.loadFailed')} error={rack.error} />;

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
                eyebrow={t('page.eyebrow')}
                title={t('page.title')}
                description={t('page.description')}
                actions={
                    <Button
                        leftSection={<IconRefresh size={16} />}
                        variant="default"
                        loading={scan.isPending}
                        onClick={() => void scan.mutateAsync()}
                    >
                        {t('page.rescan')}
                    </Button>
                }
            />

            {scan.isError ? <ErrorAlert title={t('page.scanFailed')} error={scan.error} /> : undefined}
            {membership.isError ? <ErrorAlert title={t('page.membershipFailed')} error={membership.error} /> : undefined}
            {scan.isSuccess ? <ScanResult result={scan.data} /> : undefined}

            <PadUploadCard sets={sets} />

            <SetList sets={sets} value={newSet} onChange={setNewSet} onAdd={addSet} adding={createSet.isPending} />

            {active.length === 0 ? (
                <EmptyState title={t('page.emptyTitle')}>
                    <Trans t={t} i18nKey="page.empty" components={{ code: <code /> }} />
                </EmptyState>
            ) : (
                <Card withBorder padding="md">
                    <Stack gap="sm">
                        <Eyebrow>{t('page.library')}</Eyebrow>
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
                        <Eyebrow>{t('page.turnedDown')}</Eyebrow>
                        <Text size="xs" c="dimmed">
                            {t('page.turnedDownHint')}
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
                title={t('page.deleteTitle', { label: deleting?.label ?? '' })}
                confirmLabel={t('page.deleteConfirm')}
                onConfirm={async () => {
                    if (deleting !== undefined) await remove.mutateAsync(deleting.id);
                    setDeleting(undefined);
                }}
                onClose={() => setDeleting(undefined)}
            >
                <Trans t={t} i18nKey="page.deleteBody" values={{ name: deleting?.name ?? '' }} components={{ code: <code /> }} />
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
    const { t } = useTranslation(['pads', 'common']);
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
                <Eyebrow>{t('sets.eyebrow')}</Eyebrow>
                <Text size="xs" c="dimmed">
                    {t('sets.hint')}
                </Text>

                {sets.length === 0 ? undefined : (
                    <Table.ScrollContainer minWidth={520}>
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
                                                {t('sets.sounds', { count: set.pads })}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="xs" c={set.personas.length === 0 ? 'dimmed' : undefined}>
                                                {set.personas.length === 0 ? t('sets.nobody') : set.personas.join(', ')}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Group gap="xs" justify="flex-end" wrap="nowrap">
                                                {editing?.id === set.id ? (
                                                    <>
                                                        <ActionIcon variant="subtle" aria-label={t('sets.save')} onClick={() => void save()}>
                                                            <IconCheck size={16} />
                                                        </ActionIcon>
                                                        <ActionIcon
                                                            variant="subtle"
                                                            aria-label={t('common:action.cancel')}
                                                            onClick={() => setEditing(undefined)}
                                                        >
                                                            <IconX size={16} />
                                                        </ActionIcon>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Tooltip
                                                            label={
                                                                set.personas.length === 0
                                                                    ? t('sets.rename')
                                                                    : t('sets.renameUnpoints', { personas: set.personas.join(', ') })
                                                            }
                                                        >
                                                            <ActionIcon
                                                                variant="subtle"
                                                                aria-label={t('sets.renameSet', { key: set.key })}
                                                                onClick={() => setEditing({ id: set.id, key: set.key })}
                                                            >
                                                                <IconPencil size={16} />
                                                            </ActionIcon>
                                                        </Tooltip>
                                                        <Tooltip label={t('sets.removeHint')}>
                                                            <ActionIcon
                                                                variant="subtle"
                                                                color="red"
                                                                aria-label={t('sets.deleteSet', { key: set.key })}
                                                                onClick={() => setDeleting(set)}
                                                            >
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
                    </Table.ScrollContainer>
                )}

                <Group gap="xs">
                    <TextInput
                        size="xs"
                        placeholder={t('sets.newPlaceholder')}
                        value={value}
                        onChange={event => onChange(event.currentTarget.value)}
                        onKeyDown={event => (event.key === 'Enter' ? onAdd() : undefined)}
                    />
                    <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} loading={adding} onClick={onAdd}>
                        {t('sets.add')}
                    </Button>
                </Group>

                <ConfirmModal
                    opened={deleting !== undefined}
                    title={t('sets.deleteTitle', { key: deleting?.key ?? '' })}
                    confirmLabel={t('sets.deleteConfirm')}
                    onConfirm={async () => {
                        if (deleting !== undefined) await remove.mutateAsync(deleting.id);
                        setDeleting(undefined);
                    }}
                    onClose={() => setDeleting(undefined)}
                >
                    {t('sets.deleteBody')}{' '}
                    {deleting !== undefined && deleting.personas.length > 0
                        ? t('sets.leftWithNothing', { personas: deleting.personas.join(', ') })
                        : t('sets.nobodyPointed')}
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
    const { t } = useTranslation('pads');
    return (
        <Table.ScrollContainer minWidth={700}>
            <Table verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>{t('table.token')}</Table.Th>
                        <Table.Th>{t('table.name')}</Table.Th>
                        <Table.Th className="da-num">{t('table.length')}</Table.Th>
                        <Table.Th className="da-num">{t('table.loudness')}</Table.Th>
                        <Table.Th>{t('table.lastHit')}</Table.Th>
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
                                    {sfxToken(pad.name)}
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
                            <Table.Td className="da-num">
                                {pad.durationMs === undefined ? '—' : t('table.seconds', { seconds: (pad.durationMs / 1000).toFixed(1) })}
                            </Table.Td>
                            <Table.Td className="da-num">
                                {pad.loudnessLufs === undefined ? (
                                    <Tooltip label={t('table.unmeasured')}>
                                        <Text size="sm" c="dimmed">
                                            —
                                        </Text>
                                    </Tooltip>
                                ) : (
                                    t('table.lufs', { value: pad.loudnessLufs.toFixed(1) })
                                )}
                            </Table.Td>
                            <Table.Td>
                                {/* The feed's own stamp rather than a second way of writing a time. A pad
                                nobody has reached for says so in words, because "—" here would read
                                as a value the station failed to record. */}
                                {pad.lastUsedAt === undefined ? (
                                    <Text size="xs" c="dimmed">
                                        {t('table.never')}
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
                                        aria-label={t('table.onSet', { pad: pad.name, set: set.key })}
                                        onChange={event => onToggle?.(set.id, pad.id, event.currentTarget.checked)}
                                    />
                                </Table.Td>
                            ))}
                            <Table.Td>
                                <Group gap="xs" justify="flex-end" wrap="nowrap">
                                    <Tooltip label={t('table.hear')}>
                                        <ActionIcon
                                            variant="subtle"
                                            aria-label={t('table.play', { label: pad.label })}
                                            loading={preview.isLoading(pad.id)}
                                            onClick={() => preview.play(pad.id, () => fetchPadAudio(pad.id), t('table.playFailed'))}
                                        >
                                            {preview.isPlaying(pad.id) ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlay size={16} />}
                                        </ActionIcon>
                                    </Tooltip>
                                    <Tooltip label={t('table.download')}>
                                        <ActionIcon
                                            variant="subtle"
                                            aria-label={t('table.downloadLabel', { label: pad.label })}
                                            onClick={() => void download(pad)}
                                        >
                                            <IconDownload size={16} />
                                        </ActionIcon>
                                    </Tooltip>
                                    {onReject ? (
                                        <Tooltip label={t('table.reject')}>
                                            <ActionIcon
                                                variant="subtle"
                                                color="red"
                                                aria-label={t('table.rejectLabel', { label: pad.label })}
                                                onClick={() => onReject(pad.id)}
                                            >
                                                <IconX size={16} />
                                            </ActionIcon>
                                        </Tooltip>
                                    ) : undefined}
                                    {onRestore ? (
                                        <Tooltip label={t('table.restore')}>
                                            <ActionIcon
                                                variant="subtle"
                                                aria-label={t('table.restoreLabel', { label: pad.label })}
                                                onClick={() => onRestore(pad.id)}
                                            >
                                                <IconRotate size={16} />
                                            </ActionIcon>
                                        </Tooltip>
                                    ) : undefined}
                                    {/* Only for a file this console wrote. One the operator dropped in
                                    themselves is theirs, and deleting the row would only bring it
                                    back on the next scan; the reject above is the answer there. */}
                                    {onDelete && pad.source !== 'library' ? (
                                        <Tooltip label={t('table.delete')}>
                                            <ActionIcon
                                                variant="subtle"
                                                color="red"
                                                aria-label={t('table.deleteLabel', { label: pad.label })}
                                                onClick={() => onDelete(pad)}
                                            >
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
        </Table.ScrollContainer>
    );
}

/**
 * Get one sound back off the station.
 *
 * Through the same blob URL the preview uses, because the audio route wants the console's bearer
 * token and a plain `<a href>` carries none. Named after the pad rather than after the file it
 * arrived as, since the name is what the station actually holds it under.
 *
 * Until [backup-and-restore](https://github.com/robert-dean/deadair/discussions/6) lands this is the only way out, which is why it is here at
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
    const { t } = useTranslation('pads');
    return (
        <Card withBorder padding="sm">
            <Text size="sm">
                {/* The replaced count is bold only when something was, so the tag is drawn as nothing at 0. */}
                <Trans
                    t={t}
                    i18nKey="scan.summary"
                    count={result.scanned}
                    values={{ imported: result.imported, replaced: result.replaced, skipped: result.skipped }}
                    components={{ b: result.replaced > 0 ? <Text span fw={600} /> : <></> }}
                />
                {result.contested > 0 ? (
                    <Text span fw={600}>
                        {' '}
                        {t('scan.contested', { count: result.contested })}
                    </Text>
                ) : undefined}
            </Text>
        </Card>
    );
}
