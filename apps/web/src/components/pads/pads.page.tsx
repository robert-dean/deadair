import { ActionIcon, Badge, Button, Card, Group, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconPlayerPauseFilled, IconPlayerPlay, IconRefresh, IconRotate, IconX } from '@tabler/icons-react';
import type { Pad } from '@deadair/sdk';

import { fetchPadAudio, usePads, useScanPads, useSetPadState } from '../../api/pads.queries';
import { useVoicePreview } from '../voices/voice.preview';
import { FeedMoment } from '../shared/dated.feed';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';

/**
 * The soundboard: the short sounds a presenter reaches for.
 *
 * ## There is no add button, and that is the design
 *
 * A pad arrives by being dropped in `media/pads/inbox/<board>/`, which is how the station already
 * takes delivery of audio — the same directory convention the segment inbox uses, and the same
 * reason: an operator who knows how to put an ident in front of deadair should not have to learn a
 * second way to put an air horn in front of it.
 *
 * So the only actions here are SCAN, PLAY and REJECT. Rejecting is a state rather than a deletion
 * because the scan re-reads that directory: a deleted row is back on the next pass, and the
 * operator's decision has to outlive it.
 *
 * ## A board is a column, not a page
 *
 * `personas.soundboard` names a board, and a board exists exactly as long as pads are on it. Grouped
 * here rather than tabbed, because the question an operator actually has is "what does the late
 * show have that the breakfast show does not", and two tabs answer that badly.
 */
export function PadsPage() {
    const rack = usePads();
    const scan = useScanPads();
    const setState = useSetPadState();

    // The console's own preview, rather than an `<audio>` element built here. Every other page that
    // plays station audio goes through this, and a second way of doing it is a second set of bugs
    // about what happens when you click the next one before the first has finished.
    const preview = useVoicePreview();

    if (rack.isPending) return <PageSkeleton variant="rows" count={6} />;
    if (rack.isError) return <ErrorAlert title="The soundboard could not be read" error={rack.error} />;

    const pads = rack.data?.pads ?? [];
    const active = pads.filter(pad => pad.state === 'active');
    const rejected = pads.filter(pad => pad.state === 'rejected');
    const boards = [...new Set(active.map(pad => pad.board))].sort();

    return (
        <Stack gap="lg">
            <PageHeader
                eyebrow="Station"
                title="Soundboard"
                description="The short sounds a presenter reaches for. Drop audio in media/pads/inbox/<board>/ and scan; a persona points at a board by name."
                actions={
                    <Button
                        leftSection={<IconRefresh size={16} />}
                        variant="default"
                        loading={scan.isPending}
                        onClick={() => void scan.mutateAsync()}
                    >
                        Scan the inbox
                    </Button>
                }
            />

            {scan.isError ? <ErrorAlert title="The inbox could not be read" error={scan.error} /> : undefined}
            {scan.isSuccess ? <ScanResult result={scan.data} /> : undefined}

            {active.length === 0 ? (
                <EmptyState title="Nothing on the rack">
                    Drop an mp3 or a wav in <code>media/pads/inbox/wisecrack/</code> and scan. The filename becomes the name a script writes, so{' '}
                    <code>airhorn.mp3</code> is <code>[sfx:airhorn]</code>, and the folder becomes the board a persona can point at.
                </EmptyState>
            ) : undefined}

            {boards.map(board => (
                <Card key={board} withBorder padding="md">
                    <Stack gap="sm">
                        <Group justify="space-between" align="center">
                            <Eyebrow>{board}</Eyebrow>
                            <Text size="xs" c="dimmed">
                                {active.filter(pad => pad.board === board).length} on this board
                            </Text>
                        </Group>
                        <PadTable
                            pads={active.filter(pad => pad.board === board)}
                            preview={preview}
                            onReject={id => void setState.mutateAsync({ id, body: { state: 'rejected' } })}
                        />
                    </Stack>
                </Card>
            ))}

            {rejected.length > 0 ? (
                <Card withBorder padding="md">
                    <Stack gap="sm">
                        <Eyebrow>Turned down</Eyebrow>
                        <Text size="xs" c="dimmed">
                            Kept rather than deleted, because the scan re-reads the inbox: a row that was removed would be back on the next pass.
                        </Text>
                        <PadTable
                            pads={rejected}
                            preview={preview}
                            onRestore={id => void setState.mutateAsync({ id, body: { state: 'active' } })}
                        />
                    </Stack>
                </Card>
            ) : undefined}
        </Stack>
    );
}

interface PadTableProps {
    pads: Pad[];
    preview: ReturnType<typeof useVoicePreview>;
    onReject?: (id: string) => void;
    onRestore?: (id: string) => void;
}

function PadTable({ pads, preview, onReject, onRestore }: PadTableProps) {
    return (
        <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
                <Table.Tr>
                    <Table.Th>What a script writes</Table.Th>
                    <Table.Th>Name</Table.Th>
                    <Table.Th className="da-num">Length</Table.Th>
                    <Table.Th className="da-num">Loudness</Table.Th>
                    <Table.Th>Last hit</Table.Th>
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
                                <Tooltip label="Nothing has measured it. A station with no analyzer never will, which is ordinary.">
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
                                {onReject ? (
                                    <Tooltip label="Take it off the board. Kept, so the next scan does not put it back.">
                                        <ActionIcon variant="subtle" color="red" onClick={() => onReject(pad.id)}>
                                            <IconX size={16} />
                                        </ActionIcon>
                                    </Tooltip>
                                ) : undefined}
                                {onRestore ? (
                                    <Tooltip label="Put it back on the board">
                                        <ActionIcon variant="subtle" onClick={() => onRestore(pad.id)}>
                                            <IconRotate size={16} />
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
 * What the last scan did, in a sentence.
 *
 * `replaced` is called out separately from `imported` because it is the one outcome with a
 * consequence an operator might not expect: every script that ever wrote that name now plays a
 * different sound, without anything else having changed.
 */
function ScanResult({ result }: { result: { scanned: number; imported: number; replaced: number; skipped: number } }) {
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
            </Text>
        </Card>
    );
}
