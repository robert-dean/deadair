import { useState } from 'react';
import { Alert, Badge, Button, Divider, FileButton, Group, List, Modal, Stack, Table, Text } from '@mantine/core';
import type { PersonaFile, PersonaImportNotice, PersonaImportPlan, PersonaImportResult } from '@deadair/sdk';

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
            setUnreadable(`"${chosen.name}" is not a file this can read. A persona file is the JSON one of these pages saved.`);
            return;
        }

        setFile(parsed);
        preview.mutate(parsed);
    };

    const result = write.data;
    const plan = result?.plan ?? preview.data;

    return (
        <Modal opened={opened} onClose={close} title="Import personas" size="lg" fullScreen={phone}>
            <Stack gap="md">
                <Text size="sm" c="dimmed">
                    A file saved by this page, or by somebody else&apos;s station. Characters are matched by their key: one this station already has
                    is rewritten and its stories are added to, and one it does not is created. Nothing is ever deleted, and nobody is put on air.
                </Text>

                <Group gap="sm">
                    <FileButton onChange={file => void choose(file)} accept="application/json,.json">
                        {props => (
                            <Button {...props} variant="default" loading={preview.isPending}>
                                {name === undefined ? 'Choose a file' : 'Choose another file'}
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
                    <ErrorAlert
                        title="That file could not be read"
                        error={preview.error}
                        fallback="It is JSON, but not a persona file this station recognises."
                    />
                ) : undefined}

                {write.error ? (
                    <ErrorAlert
                        title="Nothing was imported"
                        error={write.error}
                        fallback="The station is exactly as it was: an import that fails part-way is undone in full."
                    />
                ) : undefined}

                {result ? <ImportResult result={result} /> : undefined}

                {plan ? <ImportPlan plan={plan} /> : undefined}

                {plan && result === undefined ? (
                    <Group justify="flex-end">
                        <Button variant="subtle" onClick={close}>
                            Cancel
                        </Button>
                        <Button loading={write.isPending} disabled={plan.personas.length === 0} onClick={() => file && write.mutate(file)}>
                            {importLabel(plan)}
                        </Button>
                    </Group>
                ) : undefined}

                {result ? (
                    <Group justify="flex-end">
                        <Button onClick={close}>Done</Button>
                    </Group>
                ) : undefined}
            </Stack>
        </Modal>
    );
}

/** What landed, said in numbers, because the plan above already said which characters. */
function ImportResult({ result }: { result: PersonaImportResult }) {
    return (
        <Alert color="green" title="Imported">
            <Text size="sm">
                {count(result.created, 'character', 'characters')} written, {count(result.updated, 'sheet', 'sheets')} rewritten,{' '}
                {count(result.storiesWritten, 'story', 'stories')} and {count(result.detailsWritten, 'detail', 'details')} added.
            </Text>
            <Text size="sm" mt="xs">
                Nobody was put on air. Use <strong>Put on air</strong> on a character&apos;s card when you want it presenting.
            </Text>
        </Alert>
    );
}

/** Every character in the file, what would become of it, and what this station cannot honour. */
function ImportPlan({ plan }: { plan: PersonaImportPlan }) {
    return (
        <Stack gap="sm">
            {plan.notices.length > 0 ? <Notices notices={plan.notices} /> : undefined}

            <Divider />

            <Table.ScrollContainer minWidth={500}>
                <Table verticalSpacing="xs">
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Character</Table.Th>
                            <Table.Th w={90}>Lands as</Table.Th>
                            <Table.Th w={140}>Stories</Table.Th>
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
                                                    Caller
                                                </Badge>
                                            ) : undefined}
                                        </Group>
                                        {entry.notices.length > 0 ? <Notices notices={entry.notices} /> : undefined}
                                    </Stack>
                                </Table.Td>
                                <Table.Td>
                                    <Badge size="sm" variant="light" color={entry.outcome === 'create' ? 'teal' : 'blue'}>
                                        {entry.outcome === 'create' ? 'New' : 'Rewrite'}
                                    </Badge>
                                </Table.Td>
                                <Table.Td>
                                    <Text size="xs" c="dimmed" className="da-num">
                                        {storyLine(entry.storiesNew, entry.storiesHeld)}
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
function importLabel(plan: PersonaImportPlan): string {
    const creates = plan.personas.filter(entry => entry.outcome === 'create').length;
    const updates = plan.personas.length - creates;

    if (updates === 0) return `Import ${count(creates, 'character', 'characters')}`;
    if (creates === 0) return `Rewrite ${count(updates, 'character', 'characters')}`;

    return `Import ${creates}, rewrite ${updates}`;
}

/** A character's shelf as one line, saying nothing at all when there is nothing to say. */
function storyLine(added: number, held: number): string {
    if (added === 0 && held === 0) return '—';
    if (held === 0) return `${added} new`;
    if (added === 0) return `${held} already here`;

    return `${added} new · ${held} already here`;
}

const count = (many: number, one: string, several: string): string => `${many} ${many === 1 ? one : several}`;
