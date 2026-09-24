import { useState } from 'react';
import { Alert, Badge, Button, Divider, FileButton, Group, List, Modal, Stack, Table, Text } from '@mantine/core';
import type { PersonaFile, PersonaImportNotice, PersonaImportPlan, PersonaImportResult } from '@deadair/sdk';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';

import { useImportPersonas, usePreviewPersonaImport } from '../../api/personas.queries';
import { usePhone } from '../shared/use.phone';
import { ErrorAlert } from '../shared/error.alert';
import { toneColor } from '../shared/status';

export interface PersonaImportModalProps {
    opened: boolean;
    onClose: () => void;
}

/**
 * Taking a character in from a file.
 *
 * Three states in one dialog, because they are three steps of one act and a wizard would make an
 * operator navigate their own decision: choose a file, read what it would do, do it.
 *
 * ## The file is parsed HERE before anything is sent
 *
 * A file that is not JSON at all — the wrong download, a text file, a half-saved one — gets a plain
 * sentence rather than a 422 from a schema that was never given a chance to run. Everything past
 * that point is the API's to validate, and it does: the route takes `PersonaFile`, so a document
 * that is JSON and is not a persona file is refused before any of this station is read.
 *
 * ## Why the preview is not optional
 *
 * It is not a confirmation step. The plan it shows is the DECISION — the import runs the same
 * function to make it — so what is on screen is what will happen rather than a guess at it. And the
 * notices are the only place four otherwise-invisible mismatches are ever said out loud: a voice this
 * engine does not map, a rack this station does not hold, a phrasing it can never fill, and markers
 * the character's own sample lines never use. Every one of those is otherwise found out by putting
 * the character on air.
 */
export function PersonaImportModal({ opened, onClose }: PersonaImportModalProps) {
    const phone = usePhone();
    const { t } = useTranslation('personas');
    const preview = usePreviewPersonaImport();
    const write = useImportPersonas();

    // The parsed document, held so the Import button sends exactly what was previewed rather than
    // re-reading a file the operator may have replaced on disk in between.
    const [file, setFile] = useState<PersonaFile | undefined>(undefined);
    const [name, setName] = useState<string | undefined>(undefined);
    // A file that is not JSON never reaches the API, so this failure has nowhere else to live.
    const [unreadable, setUnreadable] = useState<string | undefined>(undefined);

    const close = () => {
        setFile(undefined);
        setName(undefined);
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
        setName(chosen.name);

        let parsed: PersonaFile;
        try {
            parsed = JSON.parse(await chosen.text()) as PersonaFile;
        } catch {
            setFile(undefined);
            setUnreadable(t('import.unreadable', { name: chosen.name }));
            return;
        }

        setFile(parsed);
        preview.mutate(parsed);
    };

    const result = write.data;
    const plan = result?.plan ?? preview.data;

    return (
        <Modal opened={opened} onClose={close} title={t('import.title')} size="lg" fullScreen={phone}>
            <Stack gap="md">
                <Text size="sm" c="dimmed">
                    {t('import.intro')}
                </Text>

                <Group gap="sm">
                    <FileButton onChange={file => void choose(file)} accept="application/json,.json">
                        {props => (
                            <Button {...props} variant="default" loading={preview.isPending}>
                                {name === undefined ? t('import.choose') : t('import.chooseAnother')}
                            </Button>
                        )}
                    </FileButton>
                    {name === undefined ? undefined : (
                        <Text size="sm" c="dimmed">
                            {name}
                        </Text>
                    )}
                </Group>

                {unreadable ? <ErrorAlert tone="warning">{unreadable}</ErrorAlert> : undefined}

                {preview.error ? (
                    <ErrorAlert title={t('import.previewError.title')} error={preview.error} fallback={t('import.previewError.fallback')} />
                ) : undefined}

                {write.error ? (
                    <ErrorAlert title={t('import.writeError.title')} error={write.error} fallback={t('import.writeError.fallback')} />
                ) : undefined}

                {result ? <ImportResult result={result} /> : undefined}

                {plan ? <ImportPlan plan={plan} /> : undefined}

                {plan && result === undefined ? (
                    <Group justify="flex-end">
                        <Button variant="subtle" onClick={close}>
                            {t('action.cancel', { ns: 'common' })}
                        </Button>
                        <Button loading={write.isPending} disabled={plan.personas.length === 0} onClick={() => file && write.mutate(file)}>
                            {importLabel(plan, t)}
                        </Button>
                    </Group>
                ) : undefined}

                {result ? (
                    <Group justify="flex-end">
                        <Button onClick={close}>{t('import.done')}</Button>
                    </Group>
                ) : undefined}
            </Stack>
        </Modal>
    );
}

/** What landed, said in numbers, because the plan above already said which characters. */
function ImportResult({ result }: { result: PersonaImportResult }) {
    const { t } = useTranslation('personas');
    return (
        <Alert color="green" title={t('import.result.title')}>
            <Text size="sm">
                {t('import.result.summary', {
                    characters: t('import.characters', { count: result.created }),
                    sheets: t('import.sheets', { count: result.updated }),
                    stories: t('import.stories', { count: result.storiesWritten }),
                    details: t('import.details', { count: result.detailsWritten }),
                })}
            </Text>
            <Text size="sm" mt="xs">
                <Trans t={t} i18nKey="import.result.onAir" components={{ strong: <strong /> }} />
            </Text>
        </Alert>
    );
}

/** Every character in the file, what would become of it, and what this station cannot honour. */
function ImportPlan({ plan }: { plan: PersonaImportPlan }) {
    const { t } = useTranslation('personas');
    return (
        <Stack gap="sm">
            {plan.notices.length > 0 ? <Notices notices={plan.notices} /> : undefined}

            <Divider />

            <Table.ScrollContainer minWidth={500}>
                <Table verticalSpacing="xs">
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>{t('import.column.character')}</Table.Th>
                            <Table.Th w={90}>{t('import.column.landsAs')}</Table.Th>
                            <Table.Th w={140}>{t('import.column.stories')}</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {plan.personas.map(entry => (
                            <Table.Tr key={entry.key}>
                                <Table.Td>
                                    <Stack gap="xxs">
                                        <Group gap="xs">
                                            <Text size="sm">{entry.label}</Text>
                                            {entry.kind === 'caller' ? (
                                                <Badge size="xs" variant="outline" color="gray">
                                                    {t('import.caller')}
                                                </Badge>
                                            ) : undefined}
                                        </Group>
                                        {entry.notices.length > 0 ? <Notices notices={entry.notices} /> : undefined}
                                    </Stack>
                                </Table.Td>
                                <Table.Td>
                                    <Badge size="sm" variant="light" color={entry.outcome === 'create' ? 'teal' : 'blue'}>
                                        {entry.outcome === 'create' ? t('import.outcome.create') : t('import.outcome.update')}
                                    </Badge>
                                </Table.Td>
                                <Table.Td>
                                    <Text size="xs" c="dimmed" className="da-num">
                                        {storyLine(entry.storiesNew, entry.storiesHeld, t)}
                                    </Text>
                                </Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </Table.ScrollContainer>
        </Stack>
    );
}

/**
 * The things to know, in the station's own sentences.
 *
 * Dimmed rather than coloured, with one exception: none of these refuses an import and most describe
 * a state the station can be in perfectly well, so painting them as faults would teach an operator to
 * fear a file that is fine. The exception is `on-air`, which is the one that changes what a listener
 * hears in the next few minutes.
 */
function Notices({ notices }: { notices: readonly PersonaImportNotice[] }) {
    return (
        <List size="xs" spacing={2}>
            {notices.map((notice, index) => (
                <List.Item key={`${notice.kind}-${index}`}>
                    <Text size="xs" c={notice.kind === 'on-air' ? toneColor.fault : 'dimmed'} span>
                        {notice.message}
                    </Text>
                </List.Item>
            ))}
        </List>
    );
}

/** What the button is about to do, so it is not the same word as the dialog's title. */
function importLabel(plan: PersonaImportPlan, t: TFunction<'personas'>): string {
    const creates = plan.personas.filter(entry => entry.outcome === 'create').length;
    const updates = plan.personas.length - creates;

    if (updates === 0) return t('import.button.create', { characters: t('import.characters', { count: creates }) });
    if (creates === 0) return t('import.button.update', { characters: t('import.characters', { count: updates }) });

    return t('import.button.both', { creates, updates });
}

/** A character's shelf as one line, saying nothing at all when there is nothing to say. */
function storyLine(added: number, held: number, t: TFunction<'personas'>): string {
    if (added === 0 && held === 0) return '—';
    if (held === 0) return t('import.storyLine.added', { added });
    if (added === 0) return t('import.storyLine.held', { held });

    return t('import.storyLine.both', { added, held });
}
