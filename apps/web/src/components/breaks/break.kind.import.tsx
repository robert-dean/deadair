import { useState } from 'react';
import { Alert, Badge, Button, Code, FileButton, Group, List, Modal, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import type { BreakKindFile, BreakKindImportEntry, BreakKindImportNotice, BreakKindImportPlan, BreakKindImportResult } from '@deadair/sdk';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useImportBreakKinds, usePreviewBreakKindImport } from '../../api/break.kinds.queries';
import { ErrorAlert } from '../shared/error.alert';
import { usePhone } from '../shared/use.phone';

export interface BreakKindImportModalProps {
    opened: boolean;
    onClose: () => void;
}

/**
 * Taking kinds of break in from a file, in three steps: choose it, read what it would do, do it.
 *
 * The persona import's shape, smaller. The preview runs the moment a file is chosen and again whenever
 * a kind already here is switched between skip and replace, so what the table says is what the
 * station's own planner said for exactly that choice, notices included. Everything an import writes
 * arrives switched off, and the result says so, because a kind that came from a file is read back
 * before it airs.
 */
export function BreakKindImportModal({ opened, onClose }: BreakKindImportModalProps) {
    const phone = usePhone();
    const { t } = useTranslation(['breaks', 'common']);
    const preview = usePreviewBreakKindImport();
    const write = useImportBreakKinds();

    const [file, setFile] = useState<BreakKindFile | undefined>(undefined);
    const [name, setName] = useState<string | undefined>(undefined);
    const [unreadable, setUnreadable] = useState<string | undefined>(undefined);
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

        let parsed: BreakKindFile;
        try {
            parsed = JSON.parse(await chosen.text()) as BreakKindFile;
        } catch {
            setFile(undefined);
            setUnreadable(t('import.unreadable', { name: chosen.name }));
            return;
        }

        setFile(parsed);
        preview.mutate({ file: parsed, replace: [] });
    };

    const decide = (key: string, replace: boolean) => {
        if (file === undefined) return;
        const next = new Set(replacing);
        if (replace) next.add(key);
        else next.delete(key);
        setReplacing(next);
        preview.mutate({ file, replace: [...next] });
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
                    <FileButton onChange={chosen => void choose(chosen)} accept="application/json,.json">
                        {props => (
                            <Button {...props} variant="default" loading={preview.isPending && plan === undefined}>
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
                    <ErrorAlert title={t('import.previewFailedTitle')} error={preview.error} fallback={t('import.previewFailedFallback')} />
                ) : undefined}
                {write.error ? (
                    <ErrorAlert title={t('import.writeFailedTitle')} error={write.error} fallback={t('import.writeFailedFallback')} />
                ) : undefined}

                {result ? <ImportResult result={result} t={t} /> : undefined}

                {plan ? <ImportPlan plan={plan} t={t} onChoose={result === undefined ? decide : undefined} /> : undefined}

                {plan && result === undefined ? (
                    <Group justify="flex-end">
                        <Button variant="subtle" onClick={close}>
                            {t('common:action.cancel')}
                        </Button>
                        <Button
                            loading={write.isPending}
                            disabled={preview.isPending || !plan.kinds.some(entry => entry.outcome === 'create' || entry.outcome === 'update')}
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

function ImportResult({ result, t }: { result: BreakKindImportResult; t: TFunction<['breaks', 'common']> }) {
    return (
        <Alert color="teal" title={t('import.result.title')}>
            <Text size="sm">{t('import.result.summary', { created: result.created, updated: result.updated, skipped: result.skipped })}</Text>
            <Text size="sm" mt="xs">
                {t('import.result.off')}
            </Text>
        </Alert>
    );
}

/** A kind already here, which the operator may choose to rewrite: the only rows with a choice. */
const isHeld = (entry: BreakKindImportEntry): boolean => entry.outcome === 'skip' || entry.outcome === 'update';

function ImportPlan({
    plan,
    t,
    onChoose,
}: {
    plan: BreakKindImportPlan;
    t: TFunction<['breaks', 'common']>;
    onChoose?: (key: string, replace: boolean) => void;
}) {
    const held = plan.kinds.filter(isHeld).length;

    return (
        <Stack gap="sm">
            {plan.notices.length > 0 ? <Notices notices={plan.notices} /> : undefined}

            {onChoose !== undefined && held > 0 ? (
                <Alert color="yellow" title={t('import.held.title', { count: held })}>
                    <Text size="sm">{t('import.held.body')}</Text>
                </Alert>
            ) : undefined}

            <Table.ScrollContainer minWidth={460}>
                <Table verticalSpacing="xs">
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>{t('import.column.kind')}</Table.Th>
                            {/* One width whether or not there is a choice to make, so the column does not
                                narrow under a badge once the import is done. */}
                            <Table.Th w={180}>{t('import.column.landsAs')}</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {plan.kinds.map(entry => (
                            <Table.Tr key={entry.key}>
                                <Table.Td>
                                    <Stack gap={2}>
                                        <Group gap="xs">
                                            <Text size="sm">{entry.name}</Text>
                                            <Code>{entry.key}</Code>
                                        </Group>
                                        {entry.notices.length > 0 ? <Notices notices={entry.notices} /> : undefined}
                                    </Stack>
                                </Table.Td>
                                <Table.Td>
                                    {onChoose !== undefined && isHeld(entry) ? (
                                        <SegmentedControl
                                            size="xs"
                                            aria-label={t('import.choice.label', { name: entry.name })}
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
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </Table.ScrollContainer>
        </Stack>
    );
}

function Notices({ notices }: { notices: readonly BreakKindImportNotice[] }) {
    return (
        <List size="xs" spacing={2}>
            {notices.map((notice, index) => (
                <List.Item key={`${notice.kind}-${index}`}>
                    <Text size="xs" c="dimmed" span>
                        {notice.message}
                    </Text>
                </List.Item>
            ))}
        </List>
    );
}

const outcomeColor: Record<BreakKindImportEntry['outcome'], string> = { create: 'teal', update: 'blue', skip: 'gray', refuse: 'yellow' };

function importLabel(plan: BreakKindImportPlan, t: TFunction<['breaks', 'common']>): string {
    const writes = plan.kinds.filter(entry => entry.outcome === 'create' || entry.outcome === 'update').length;
    return writes === 0 ? t('import.button.nothing') : t('import.button.write', { count: writes });
}
