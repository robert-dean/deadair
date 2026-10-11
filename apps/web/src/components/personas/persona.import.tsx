import { useState } from 'react';
import { Alert, Badge, Button, Divider, FileButton, Group, List, Modal, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import type { PersonaFile, PersonaImportEntry, PersonaImportNotice, PersonaImportPlan, PersonaImportResult } from '@deadair/sdk';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';

import { useImportPersonas, usePreviewPersonaImport } from '../../api/personas.queries';
import { usePhone } from '../shared/use.phone';
import { upgradePersonaFile } from './persona.file.upgrade';
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
 *
 * ## A character already here is skipped until somebody says otherwise
 *
 * Matching by key is how a file finds the character it means, and it is also how a file from another
 * station finds a DIFFERENT character that happens to share a key with one of yours. So the preview
 * answers `skip` for every one this station holds, with the counts and notices a replace would get,
 * and the row offers Skip or Replace. Flipping it is decided here rather than asked of the API again,
 * which is what those counts are for; the import then names the replaced keys and plans with the same
 * function, so what lands is what the rows said.
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
    // Keys of characters already here that the operator chose to replace. Empty is the safe answer,
    // and the one every new file starts from.
    const [replacing, setReplacing] = useState<ReadonlySet<string>>(new Set());

    const close = () => {
        setFile(undefined);
        setName(undefined);
        setUnreadable(undefined);
        setReplacing(new Set());
        preview.reset();
        write.reset();
        onClose();
    };

    const choose = async (chosen: File | null) => {
        if (chosen === null) return;

        setUnreadable(undefined);
        setReplacing(new Set());
        preview.reset();
        write.reset();
        setName(chosen.name);

        let parsed: PersonaFile;
        try {
            parsed = upgradePersonaFile(JSON.parse(await chosen.text()));
        } catch {
            setFile(undefined);
            setUnreadable(t('import.unreadable', { name: chosen.name }));
            return;
        }

        setFile(parsed);
        preview.mutate(parsed);
    };

    const result = write.data;
    // Once written, the rows are what the station DID, so they come from its answer and stop offering
    // a choice. Until then they are the preview with the operator's choices laid over it.
    const plan = result?.plan ?? (preview.data === undefined ? undefined : chosen(preview.data, replacing));

    const decide = (key: string, replace: boolean) =>
        setReplacing(current => {
            const next = new Set(current);
            if (replace) next.add(key);
            else next.delete(key);
            return next;
        });

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

                {plan ? <ImportPlan plan={plan} onChoose={result === undefined ? decide : undefined} /> : undefined}

                {plan && result === undefined ? (
                    <Group justify="flex-end">
                        <Button variant="subtle" onClick={close}>
                            {t('action.cancel', { ns: 'common' })}
                        </Button>
                        <Button
                            loading={write.isPending}
                            disabled={!plan.personas.some(entry => entry.outcome !== 'skip')}
                            onClick={() => file && write.mutate({ file, replace: [...replacing] })}
                        >
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
            {result.skipped > 0 ? (
                <Text size="sm" mt="xs">
                    {t('import.result.skipped', { count: result.skipped })}
                </Text>
            ) : undefined}
            <Text size="sm" mt="xs">
                <Trans t={t} i18nKey="import.result.onAir" components={{ strong: <strong /> }} />
            </Text>
        </Alert>
    );
}

/**
 * The preview with the operator's Replace choices laid over it.
 *
 * Only a character this station already holds can change, and only between `skip` and `update`; the
 * preview gave each one the counts and notices a replace would get, so nothing else needs asking.
 */
function chosen(plan: PersonaImportPlan, replacing: ReadonlySet<string>): PersonaImportPlan {
    return {
        ...plan,
        personas: plan.personas.map(entry =>
            entry.outcome === 'create' ? entry : { ...entry, outcome: replacing.has(entry.key) ? 'update' : 'skip' },
        ),
    };
}

/** A character this station already holds, whichever way the operator has chosen. */
const isHeld = (entry: PersonaImportEntry): boolean => entry.outcome !== 'create';

/**
 * Every character in the file, what would become of it, and what this station cannot honour.
 *
 * `onChoose` is present while the operator can still decide, and absent once the import has run.
 */
function ImportPlan({ plan, onChoose }: { plan: PersonaImportPlan; onChoose?: (key: string, replace: boolean) => void }) {
    const { t } = useTranslation('personas');
    const held = plan.personas.filter(isHeld).length;
    return (
        <Stack gap="sm">
            {plan.notices.length > 0 ? <Notices notices={plan.notices} /> : undefined}

            {onChoose !== undefined && held > 0 ? (
                <Alert color="yellow" title={t('import.held.title', { count: held })}>
                    <Text size="sm">{t('import.held.body')}</Text>
                </Alert>
            ) : undefined}

            <Divider />

            <Table.ScrollContainer minWidth={500}>
                <Table verticalSpacing="xs">
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>{t('import.column.character')}</Table.Th>
                            <Table.Th w={onChoose !== undefined && held > 0 ? 170 : 90}>{t('import.column.landsAs')}</Table.Th>
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
                                            {entry.kind === 'caller' || entry.kind === 'newsreader' || entry.kind === 'guest' ? (
                                                <Badge size="xs" variant="outline" color="gray">
                                                    {entry.kind === 'caller'
                                                        ? t('import.caller')
                                                        : entry.kind === 'guest'
                                                          ? t('import.guest')
                                                          : t('import.newsreader')}
                                                </Badge>
                                            ) : undefined}
                                        </Group>
                                        {/* What a skipped character's notices describe is a replace that is not
                                            going to happen, so they wait until somebody chooses it. */}
                                        {entry.outcome !== 'skip' && entry.notices.length > 0 ? <Notices notices={entry.notices} /> : undefined}
                                    </Stack>
                                </Table.Td>
                                <Table.Td>
                                    {onChoose !== undefined && isHeld(entry) ? (
                                        <SegmentedControl
                                            size="xs"
                                            aria-label={t('import.choice.label', { label: entry.label })}
                                            value={entry.outcome === 'update' ? 'replace' : 'skip'}
                                            onChange={value => onChoose(entry.key, value === 'replace')}
                                            data={[
                                                { value: 'skip', label: t('import.choice.skip') },
                                                { value: 'replace', label: t('import.choice.replace') },
                                            ]}
                                        />
                                    ) : (
                                        <Badge size="sm" variant="light" color={outcomeColor[entry.outcome]}>
                                            {t(`import.outcome.${entry.outcome}`)}
                                        </Badge>
                                    )}
                                </Table.Td>
                                <Table.Td>
                                    <Text size="xs" c="dimmed" className="da-num">
                                        {entry.outcome === 'skip' ? '—' : storyLine(entry.storiesNew, entry.storiesHeld, t)}
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

const outcomeColor: Record<PersonaImportEntry['outcome'], string> = { create: 'teal', update: 'blue', skip: 'gray' };

/** What the button is about to do, so it is not the same word as the dialog's title. Skips are not counted: they do nothing. */
function importLabel(plan: PersonaImportPlan, t: TFunction<'personas'>): string {
    const creates = plan.personas.filter(entry => entry.outcome === 'create').length;
    const updates = plan.personas.filter(entry => entry.outcome === 'update').length;

    if (creates === 0 && updates === 0) return t('import.button.nothing');
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
