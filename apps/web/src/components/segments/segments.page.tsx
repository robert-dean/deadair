import { useState } from 'react';
import { ActionIcon, Button, Card, Group, Select, Stack, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { IconPlayerPauseFilled, IconPlayerPlayFilled, IconTrash } from '@tabler/icons-react';
import type { Segment } from '@deadair/sdk';

import { fetchSegmentAudio, useCreateSegment, useDeleteSegment, useScanSegments, useSegments } from '../../api/segments.queries';
import { SegmentUploadCard } from './segment.upload.card';
import { useVoices } from '../../api/voices.queries';
import { ConfirmModal } from '../shared/confirm.modal';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { formatDuration } from '../shared/format.duration';
import { notifyDone } from '../shared/notify';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { StatusLamp } from '../shared/status.lamp';
import type { StatusTone } from '../shared/status';
import { useVoicePreview } from '../voices/voice.preview';

/**
 * How each state reads as a lamp.
 *
 * Only `ready` is `ok`, because only `ready` can go on air: the station SKIPS anything else rather
 * than waiting for it, so a segment stuck at `written` is not a slower kind of ready. The four
 * in-flight states are `standby` rather than `live` — nothing here is airing, it is being made — and
 * `failed` is the one fault, because it is the only state that will not resolve on its own.
 */
const STATE_TONE: Record<string, StatusTone> = {
    planned: 'standby',
    writing: 'standby',
    written: 'standby',
    rendering: 'standby',
    ready: 'ok',
    failed: 'fault',
};

/** What a new segment is, unless the operator says otherwise. The kind most of them are. */
const DEFAULT_KIND = 'talkbreak';

/**
 * The library of things the station plays that are not records.
 *
 * An ident, a stinger, a talk break. The routes have existed since the render module did, and the
 * running order has been drawing segment rows the whole time, but there was no page for the library
 * itself: no way to see what the station has, hear one, or add one without posting JSON by hand.
 *
 * Two things it deliberately does not do. It cannot add a segment to the running order, which is
 * `POST /director/air/segments` and belongs to the page that owns the order rather than to the one
 * that owns the library. And it cannot re-render a `failed` segment, because there is no route that
 * does: a failed row is not re-claimable, and inventing a client-side retry would mean deleting and
 * re-creating the row, which is a different thing wearing the same button.
 */
export function SegmentsPage() {
    const segments = useSegments();
    const scan = useScanSegments();
    const [composing, setComposing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [deleting, setDeleting] = useState<Segment | undefined>(undefined);
    const remove = useDeleteSegment();

    const rows = segments.data?.segments ?? [];
    const kinds = [...new Set(rows.map(segment => segment.kind))].sort();

    return (
        <Stack gap="lg">
            <PageHeader
                title="Segments"
                description={
                    <Text size="sm" c="dimmed">
                        Everything the station can play that is not a record. A segment is only playable once it is ready; the station skips anything
                        else rather than waiting for it.
                    </Text>
                }
                actions={
                    <Group gap="xs">
                        <Tooltip label="Reads the inbox folder and imports any audio it does not already hold" openDelay={400}>
                            <Button
                                variant="default"
                                loading={scan.isPending}
                                onClick={() => {
                                    scan.mutate(undefined, {
                                        onSuccess: result =>
                                            notifyDone(
                                                result.imported === 0
                                                    ? `Nothing new in the inbox (${result.scanned} scanned).`
                                                    : `Imported ${result.imported} of ${result.scanned} scanned.`,
                                            ),
                                    });
                                }}
                            >
                                Scan the inbox
                            </Button>
                        </Tooltip>
                        <Button
                            variant="default"
                            onClick={() => {
                                setUploading(open => !open);
                            }}
                        >
                            Upload
                        </Button>
                        <Button
                            onClick={() => {
                                setComposing(open => !open);
                            }}
                        >
                            Write one
                        </Button>
                    </Group>
                }
            />

            {segments.error ? (
                <ErrorAlert title="The segment library could not be read" error={segments.error} fallback="The library is unavailable." />
            ) : undefined}

            {scan.error ? <ErrorAlert title="The inbox could not be scanned" error={scan.error} fallback="The scan did not finish." /> : undefined}

            {uploading ? <SegmentUploadCard kinds={kinds} onDone={() => setUploading(false)} /> : undefined}

            {composing ? (
                <ComposeSegment
                    onDone={() => {
                        setComposing(false);
                    }}
                />
            ) : undefined}

            {segments.isPending ? <PageSkeleton variant="table" /> : undefined}

            {segments.data && rows.length === 0 ? (
                <EmptyState title="The station has no segments">
                    Upload a recording above, write one for the station to say, or drop audio into the inbox folder and scan it. The station plays
                    what it has; without a segment it plays records back to back.
                </EmptyState>
            ) : undefined}

            {/* Grouped by kind rather than listed flat, because the kinds are what an operator
                arrives looking for: an ident and a talk break are different jobs, and a library with
                forty of one and two of the other reads as a wall otherwise. */}
            {kinds.map(kind => (
                <Stack key={kind} gap="xs">
                    <Eyebrow>{kind}</Eyebrow>
                    <SegmentTable segments={rows.filter(segment => segment.kind === kind)} onDelete={setDeleting} />
                </Stack>
            ))}

            <ConfirmModal
                opened={deleting !== undefined}
                title={`Delete ${deleting?.label ?? ''}?`}
                confirmLabel="Delete the recording"
                onConfirm={async () => {
                    if (deleting !== undefined) await remove.mutateAsync(deleting.id);
                    setDeleting(undefined);
                }}
                onClose={() => setDeleting(undefined)}
            >
                The inbox file goes too, so the next scan does not read it back in. Anything the station has already aired stays in the activity feed
                either way.
            </ConfirmModal>
        </Stack>
    );
}

/** One kind's segments, with the state each is in and a way to hear the ones that have audio. */
function SegmentTable({ segments, onDelete }: { segments: Segment[]; onDelete?: (segment: Segment) => void }) {
    const preview = useVoicePreview();

    return (
        <Table.ScrollContainer minWidth={800}>
            <Table highlightOnHover>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th w={44} />
                        {/* Wide enough for a real label. Left to share the row with the script, a
                        generated one like "Open line: the last word (7/7)" wraps to five lines and
                        makes every row four times as tall as the sentence beside it. */}
                        <Table.Th w={220}>Label</Table.Th>
                        <Table.Th>Script</Table.Th>
                        <Table.Th w={130}>State</Table.Th>
                        <Table.Th w={110}>Voice</Table.Th>
                        <Table.Th w={90}>Length</Table.Th>
                        <Table.Th w={44} />
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {segments.map(segment => {
                        const failure = preview.failureFor(segment.id);

                        return (
                            <Table.Tr key={segment.id}>
                                <Table.Td>
                                    {/* Only where there is audio to play. `playable` is the row's own
                                    answer to that, so a segment still being rendered offers no
                                    button rather than one that 404s. */}
                                    {segment.playable ? (
                                        <ActionIcon
                                            variant="subtle"
                                            size="sm"
                                            aria-label={`Play ${segment.label}`}
                                            loading={preview.isLoading(segment.id)}
                                            onClick={() => {
                                                preview.play(segment.id, () => fetchSegmentAudio(segment.id), 'That segment would not play.');
                                            }}
                                        >
                                            {preview.isPlaying(segment.id) ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
                                        </ActionIcon>
                                    ) : undefined}
                                </Table.Td>
                                <Table.Td>
                                    <Text size="sm">{segment.label}</Text>
                                    <Text size="xs" c="dimmed">
                                        {segment.source}
                                    </Text>
                                    {failure === undefined ? undefined : (
                                        <Text size="xs" c="red.4">
                                            {failure}
                                        </Text>
                                    )}
                                </Table.Td>
                                <Table.Td>
                                    <Text size="sm" c="dimmed" lineClamp={2}>
                                        {segment.script ?? '—'}
                                    </Text>
                                </Table.Td>
                                <Table.Td>
                                    <StatusLamp tone={STATE_TONE[segment.state] ?? 'standby'} label={segment.state} />
                                    {/* The reason it failed, which is the only thing that makes a failed
                                    row actionable: there is no retry button, so what is left is
                                    knowing what to fix. */}
                                    {segment.error === undefined ? undefined : (
                                        <Text size="xs" c="red.4" lineClamp={2}>
                                            {segment.error}
                                        </Text>
                                    )}
                                </Table.Td>
                                <Table.Td>
                                    <Text size="xs" c="dimmed">
                                        {segment.voice ?? 'default'}
                                    </Text>
                                    {/* How the words were read, when the writer chose a reading at all.
                                    Beside the voice because it is the other half of how this row
                                    sounds, and absent for nearly every row. */}
                                    {segment.delivery === undefined ? undefined : (
                                        <Text size="xs" c="dimmed" fs="italic">
                                            {segment.delivery}
                                        </Text>
                                    )}
                                </Table.Td>

                                <Table.Td className="da-num">{segment.durationMs === undefined ? '—' : formatDuration(segment.durationMs)}</Table.Td>
                                <Table.Td>
                                    {/* Only for a recording the station was GIVEN. Anything it wrote and
                                    spoke for itself is named by the running order and recorded in
                                    the script history, and the way to have it again is a re-render
                                    rather than a re-upload — so there is nothing here to take back. */}
                                    {segment.source === 'library' ? (
                                        <Tooltip label="Remove it, and the inbox file behind it">
                                            <ActionIcon
                                                variant="subtle"
                                                size="sm"
                                                color="red"
                                                aria-label={`Delete ${segment.label}`}
                                                onClick={() => onDelete?.(segment)}
                                            >
                                                <IconTrash size={14} />
                                            </ActionIcon>
                                        </Tooltip>
                                    ) : undefined}
                                </Table.Td>
                            </Table.Tr>
                        );
                    })}
                </Table.Tbody>
            </Table>
        </Table.ScrollContainer>
    );
}

/**
 * Writing a new segment.
 *
 * The POST answers `planned` every time, because speaking it is a job. So this closes on success and
 * lets the list's own poll carry the row through `rendering` to `ready`, rather than waiting on
 * something that has not happened yet.
 */
function ComposeSegment({ onDone }: { onDone: () => void }) {
    const create = useCreateSegment();
    const voices = useVoices(true);

    const [label, setLabel] = useState('');
    const [script, setScript] = useState('');
    const [kind, setKind] = useState(DEFAULT_KIND);
    const [voice, setVoice] = useState<string | undefined>(undefined);

    const ready = label.trim().length > 0 && script.trim().length > 0;

    return (
        <Card padding="md">
            <Stack gap="sm">
                <TextInput
                    label="Label"
                    description="What the console calls it, and the mount label while it airs"
                    value={label}
                    onChange={event => {
                        setLabel(event.currentTarget.value);
                    }}
                />
                <Textarea
                    label="Script"
                    description="What the station says. The pronunciation list is applied when it is spoken."
                    autosize
                    minRows={3}
                    value={script}
                    onChange={event => {
                        setScript(event.currentTarget.value);
                    }}
                />
                <Group gap="md" wrap="wrap">
                    <TextInput
                        label="Kind"
                        w={{ base: '100%', sm: 200 }}
                        description="ident, stinger, talkbreak"
                        value={kind}
                        onChange={event => {
                            setKind(event.currentTarget.value);
                        }}
                    />
                    <Select
                        label="Voice"
                        w={{ base: '100%', sm: 220 }}
                        description="Leave empty for the plugin's own default"
                        clearable
                        // The plugin's own default answers to the empty string, which Mantine cannot hold as
                        // an option value and which this Select already expresses by being cleared. So the
                        // row for it is dropped rather than drawn as a second way to say the same thing.
                        data={(voices.data?.voices ?? []).filter(one => one.id.length > 0).map(one => ({ value: one.id, label: one.label }))}
                        value={voice ?? null}
                        onChange={next => {
                            setVoice(next ?? undefined);
                        }}
                    />
                </Group>

                {create.error ? (
                    <ErrorAlert title="That segment could not be planned" error={create.error} fallback="The station did not take it." />
                ) : undefined}

                <Group gap="xs">
                    <Button
                        disabled={!ready}
                        loading={create.isPending}
                        onClick={() => {
                            create.mutate(
                                {
                                    label: label.trim(),
                                    script: script.trim(),
                                    kind: kind.trim() === '' ? DEFAULT_KIND : kind.trim(),
                                    ...(voice === undefined ? {} : { voice }),
                                },
                                {
                                    onSuccess: () => {
                                        notifyDone('Planned. The station is speaking it now.');
                                        onDone();
                                    },
                                },
                            );
                        }}
                    >
                        Plan it
                    </Button>
                    <Button variant="default" onClick={onDone}>
                        Cancel
                    </Button>
                </Group>
            </Stack>
        </Card>
    );
}
