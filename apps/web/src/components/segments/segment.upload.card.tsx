import { useState } from 'react';
import { ActionIcon, Alert, Autocomplete, Button, Card, Group, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconInfoCircle, IconTrash, IconUpload, IconVolume, IconX } from '@tabler/icons-react';
import { Trans, useTranslation } from 'react-i18next';

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
    const { t } = useTranslation('segments');
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

    // The kinds the station itself plays from the shelf are offered whether or not anything is filed
    // under them yet, and are never "unfamiliar": a jingle recorded for the first time is not a new
    // hour on the clock, it is what `rotation.jingleEveryMinutes` was waiting for.
    const offered = [...new Set([...STATION_KINDS, ...kinds])].sort();
    const unfamiliar = kind.trim() !== '' && !offered.includes(kind.trim());

    return (
        <Card withBorder padding="md">
            <Stack gap="sm">
                <Eyebrow>{t('uploadCard.title')}</Eyebrow>

                {upload.isError ? <ErrorAlert title={t('uploadCard.error')} error={upload.error} /> : undefined}

                <Group align="flex-start" gap="sm">
                    <Autocomplete
                        label={t('uploadCard.kind.label')}
                        description={t('uploadCard.kind.description')}
                        data={offered}
                        value={kind}
                        onChange={setKind}
                        style={{ flex: '0 0 16rem' }}
                    />
                    {unfamiliar ? (
                        <Alert variant="light" color="yellow" icon={<IconInfoCircle size={16} />} style={{ flex: 1 }}>
                            <Trans t={t} i18nKey="uploadCard.kind.unfamiliar" values={{ kind: kind.trim() }} components={{ strong: <strong /> }} />
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
                            <Text size="sm">{t('uploadCard.drop')}</Text>
                            <Text size="xs" c="dimmed">
                                {t('uploadCard.dropHint')}
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
                                        <Table.Th>{t('uploadCard.column.file')}</Table.Th>
                                        <Table.Th>{t('uploadCard.column.label')}</Table.Th>
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
                                                    aria-label={t('uploadCard.labelFor', { name: one.file.name })}
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
                                                <Tooltip label={t('uploadCard.discardTooltip')}>
                                                    <ActionIcon
                                                        variant="subtle"
                                                        color="red"
                                                        aria-label={t('uploadCard.discard', { name: one.file.name })}
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
                                {t('uploadCard.clear')}
                            </Button>
                            <Button
                                leftSection={<IconUpload size={16} />}
                                loading={upload.isPending}
                                disabled={kind.trim() === '' || staged.some(one => one.label.trim() === '')}
                                onClick={() => void send()}
                            >
                                {t('uploadCard.send', { count: staged.length })}
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

/**
 * Kinds the station draws from the library by itself: an ident between talk breaks, and a jingle
 * between records. The API's `IDENT_KIND` and `JINGLE_KIND`.
 */
const STATION_KINDS = ['ident', 'jingle'];

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
