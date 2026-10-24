import { useState } from 'react';
import { ActionIcon, Box, Button, Code, Group, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconDownload, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { BreakKind, BreakKindInput, ClockBandList } from '@deadair/sdk';

import { exportBreakKinds, useBreakKinds, useCreateBreakKind, useDeleteBreakKind, useUpdateBreakKind } from '../../api/break.kinds.queries';
import { useClockBands } from '../../api/clock.queries';
import { ConfirmModal } from '../shared/confirm.modal';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { QueryView } from '../shared/query.view';
import { StatusLamp } from '../shared/status.lamp';
import { BreakKindEditor, type BreakKindTarget } from './break.kind.editor';
import { BreakKindImportModal } from './break.kind.import';

/** What `exporting` holds while the whole list is being saved rather than one kind. */
const ALL = '*';

/**
 * The kinds of break an operator writes. Ideas #24.
 *
 * A list and an editor, like Subjects beside it, and one thing more: each row says whether it can
 * actually air. A kind switched on is still silent until a band on the format clock names it, and
 * silent again while the station has no model or no voice to write and speak it with, so the row
 * says which of those it is waiting on. Both answers are the clock's own (its bands, and the kinds it
 * says it can produce), which is the planner's answer, so this page cannot disagree with what the
 * station does.
 *
 * Deleting is confirmed, and refused by the station while a band still names the kind; the refusal
 * arrives as the API's own sentence, saying how many bands, which is the fact an operator needs to
 * go and remove them.
 */
export function BreakKindsPage() {
    const { t } = useTranslation('breaks');
    const kinds = useBreakKinds();
    // Already drawn by the schedule page, so usually a cached read: which bands name a kind, and which
    // kinds the station can make right now.
    const clock = useClockBands();
    const create = useCreateBreakKind();
    const update = useUpdateBreakKind();
    const remove = useDeleteBreakKind();

    const [editing, setEditing] = useState<BreakKindTarget | undefined>(undefined);
    const [deleting, setDeleting] = useState<BreakKind | undefined>(undefined);
    const [importing, setImporting] = useState(false);
    const [exporting, setExporting] = useState<string | undefined>(undefined);
    const [exportFailure, setExportFailure] = useState<unknown>(undefined);

    // One kind, or all of them. The failure is reported once at the top of the page whichever it was.
    const save = async (id?: string) => {
        setExporting(id ?? ALL);
        setExportFailure(undefined);
        try {
            await exportBreakKinds(id);
        } catch (error) {
            setExportFailure(error);
        } finally {
            setExporting(undefined);
        }
    };

    const close = () => {
        setEditing(undefined);
        create.reset();
        update.reset();
    };

    const all = kinds.data?.kinds ?? [];

    const submit = async (draft: BreakKindInput) => {
        if (editing?.kind === 'edit') await update.mutateAsync({ id: editing.breakKind.id, body: draft });
        // After the last one, worked out now rather than when the editor opened: New can be pressed
        // before the list has arrived, and a place counted then would put this first.
        else await create.mutateAsync({ ...draft, position: (all.at(-1)?.position ?? -1) + 1 });

        close();
    };

    return (
        <Stack gap="lg">
            <PageHeader
                title={t('page.title')}
                description={
                    <Text c="dimmed" size="sm" maw={720}>
                        {t('page.description')}
                    </Text>
                }
                actions={
                    <Group gap="xs">
                        <Button variant="default" onClick={() => setImporting(true)}>
                            {t('page.import')}
                        </Button>
                        {all.length > 0 ? (
                            <Button variant="default" loading={exporting === ALL} onClick={() => void save()}>
                                {t('page.exportAll')}
                            </Button>
                        ) : undefined}
                        <Button onClick={() => setEditing({ kind: 'new' })}>{t('page.new')}</Button>
                    </Group>
                }
            />

            {exportFailure ? (
                <ErrorAlert title={t('page.exportFailedTitle')} error={exportFailure} fallback={t('page.loadFailedFallback')} />
            ) : undefined}

            {remove.error && deleting === undefined ? (
                <ErrorAlert title={t('page.deleteFailedTitle')} error={remove.error} fallback={t('page.nothingRemoved')} />
            ) : undefined}

            <QueryView
                query={kinds}
                skeleton={<PageSkeleton variant="card" />}
                errorTitle={t('page.loadFailedTitle')}
                errorFallback={t('page.loadFailedFallback')}
                isEmpty={data => data.kinds.length === 0}
                empty={<EmptyState title={t('page.empty.title')}>{t('page.empty.body')}</EmptyState>}
            >
                {data => (
                    <Table.ScrollContainer minWidth={560}>
                        <Table verticalSpacing="xs" highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('page.column.name')}</Table.Th>
                                    <Table.Th>{t('page.column.key')}</Table.Th>
                                    <Table.Th>{t('page.column.state')}</Table.Th>
                                    <Table.Th w={72} />
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {data.kinds.map(breakKind => (
                                    <Table.Tr
                                        key={breakKind.id}
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => setEditing({ kind: 'edit', breakKind })}
                                    >
                                        <Table.Td>
                                            <Text size="sm">{breakKind.name}</Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Code>{breakKind.key}</Code>
                                        </Table.Td>
                                        <Table.Td>
                                            <Group gap="xs">
                                                <StateBadge breakKind={breakKind} clock={clock.data} t={t} />
                                                <Text size="xs" c="dimmed">
                                                    {bandsFor(breakKind, clock.data, t)}
                                                </Text>
                                            </Group>
                                        </Table.Td>
                                        <Table.Td>
                                            <Group gap={2} justify="flex-end" onClick={event => event.stopPropagation()}>
                                                <ActionIcon
                                                    size="sm"
                                                    variant="subtle"
                                                    color="gray"
                                                    aria-label={t('page.exportAriaLabel', { name: breakKind.name })}
                                                    loading={exporting === breakKind.id}
                                                    onClick={() => void save(breakKind.id)}
                                                >
                                                    <IconDownload size={14} />
                                                </ActionIcon>
                                                <ActionIcon
                                                    size="sm"
                                                    variant="subtle"
                                                    color="red"
                                                    aria-label={t('page.deleteAriaLabel', { name: breakKind.name })}
                                                    onClick={() => {
                                                        remove.reset();
                                                        setDeleting(breakKind);
                                                    }}
                                                >
                                                    <IconTrash size={14} />
                                                </ActionIcon>
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                )}
            </QueryView>

            <Text size="xs" c="dimmed" maw={720}>
                {t('page.notes.rules')}
            </Text>

            {editing ? (
                <BreakKindEditor
                    // Keyed on what it is open on, so the form reads its values once per kind.
                    key={editing.kind === 'edit' ? editing.breakKind.id : 'new'}
                    target={editing}
                    onClose={close}
                    onSubmit={submit}
                    pending={create.isPending || update.isPending}
                    error={create.error ?? update.error}
                />
            ) : undefined}

            <BreakKindImportModal opened={importing} onClose={() => setImporting(false)} />

            <ConfirmModal
                opened={deleting !== undefined}
                onClose={() => setDeleting(undefined)}
                onConfirm={() => {
                    if (deleting === undefined) return;
                    remove.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) });
                }}
                title={deleting ? t('page.confirm.title', { name: deleting.name }) : t('page.confirm.titleFallback')}
                confirmLabel={t('page.confirm.confirm')}
                confirming={remove.isPending}
                error={remove.error}
                errorTitle={t('page.confirm.errorTitle')}
                errorFallback={t('page.nothingRemoved')}
            >
                {t('page.confirm.body')}
            </ConfirmModal>
        </Stack>
    );
}

/**
 * Whether the kind can air: off, on, or on and waiting for a model or a voice.
 *
 * "Waiting" only once the clock has answered, so a row is never accused while the answer is on its
 * way, which is `ClockPanel`'s rule for the same list.
 */
function StateBadge({ breakKind, clock, t }: { breakKind: BreakKind; clock?: ClockBandList; t: TFunction<'breaks'> }) {
    if (!breakKind.enabled) return <StatusLamp tone="off" label={t('page.state.off')} />;
    // `standby` rather than `fault`: nothing is broken, the station is waiting on a switch elsewhere.
    if (clock !== undefined && !clock.producibleKinds.includes(breakKind.key)) {
        return (
            <Tooltip label={t('page.state.blockedHint')} multiline w={280}>
                <Box>
                    <StatusLamp tone="standby" label={t('page.state.blocked')} />
                </Box>
            </Tooltip>
        );
    }

    return <StatusLamp tone="ok" label={t('page.state.on')} />;
}

/** How many bands on the format clock name this kind, switched on or not. */
function bandsFor(breakKind: BreakKind, clock: ClockBandList | undefined, t: TFunction<'breaks'>): string {
    if (clock === undefined) return '';
    const count = clock.bands.filter(band => band.kind === breakKind.key).length;
    return count === 0 ? t('page.noBands') : t('page.bands', { count });
}
