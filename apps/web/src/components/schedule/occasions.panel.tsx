import { useState } from 'react';
import { ActionIcon, Badge, Button, Card, Group, Select, Stack, Switch, Text, TextInput } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconPencil, IconTrash } from '@tabler/icons-react';
import type { Occasion, OccasionCalendarMonths } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import {
    exportOccasions,
    useAddOccasion,
    useChangeOccasion,
    useOccasions,
    useRemoveOccasion,
    useReorderOccasions,
} from '../../api/occasions.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { formatCivilDate } from '../../i18n/format.locale';
import { MOODS, type Mood } from '../programme/programme.fields';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { OccasionsImportModal } from './occasions.import';
import { RuleFields, RuleKindField } from './rule.fields';
import { BLANK_OCCASION, describeRule, draftOfOccasion, inputOfDraft, inputOfOccasion, movedOccasion, type OccasionDraft } from './occasions.edits';

const isMood = (value: string | null): value is Mood => (MOODS as readonly (string | null)[]).includes(value);

/**
 * What a date means where this station is: the days a presenter knows about, and what each leans into.
 *
 * A list rather than anything on the timetable, because an occasion is not a show: it adds to the day
 * rather than replacing what is on, so a Christmas morning is still a morning.
 */
export function OccasionsPanel() {
    const { t } = useTranslation('schedule');
    const occasions = useOccasions();
    const change = useChangeOccasion();
    const remove = useRemoveOccasion();
    const reorder = useReorderOccasions();
    const [editing, setEditing] = useState<Occasion | undefined>();
    const [importing, setImporting] = useState(false);
    const [exportFailed, setExportFailed] = useState<string | undefined>();

    const saveExport = async () => {
        setExportFailed(undefined);
        try {
            await exportOccasions();
        } catch (error) {
            setExportFailed(apiErrorMessage(error, t('occasions.failedFallback')));
        }
    };

    const rows = occasions.data?.occasions ?? [];
    const ids = rows.map(occasion => occasion.id);
    const failed = [change, remove, reorder].find(write => write.isError);

    return (
        <Stack gap="lg">
            <Card padding="lg">
                <Stack gap="sm">
                    <Group justify="space-between" wrap="wrap">
                        <Eyebrow>{t('occasions.title')}</Eyebrow>
                        <Group gap="xs">
                            <Button size="xs" variant="default" onClick={() => void saveExport()}>
                                {t('occasions.export')}
                            </Button>
                            <Button size="xs" variant="default" onClick={() => setImporting(true)}>
                                {t('occasions.importOpen')}
                            </Button>
                        </Group>
                    </Group>
                    {exportFailed ? <ErrorAlert title={t('occasions.exportFailed')}>{exportFailed}</ErrorAlert> : undefined}
                    <Text size="sm" c="dimmed">
                        {t('occasions.description')}
                    </Text>
                    {occasions.isError ? (
                        <ErrorAlert title={t('occasions.loadFailed')}>
                            {apiErrorMessage(occasions.error, t('occasions.loadFailedFallback'))}
                        </ErrorAlert>
                    ) : undefined}
                    {failed ? (
                        <ErrorAlert title={t('occasions.failed')}>{apiErrorMessage(failed.error, t('occasions.failedFallback'))}</ErrorAlert>
                    ) : undefined}
                    {occasions.isSuccess && rows.length === 0 ? (
                        <EmptyState title={t('occasions.emptyTitle')}>{t('occasions.empty')}</EmptyState>
                    ) : undefined}

                    {rows.map((occasion, index) => (
                        <OccasionRow
                            key={occasion.id}
                            occasion={occasion}
                            first={index === 0}
                            last={index === rows.length - 1}
                            onToggle={enabled => change.mutate({ id: occasion.id, occasion: { ...inputOfOccasion(occasion), enabled } })}
                            onMood={mood => {
                                const { mood: _mood, ...rest } = inputOfOccasion(occasion);
                                change.mutate({ id: occasion.id, occasion: { ...rest, ...(mood === undefined ? {} : { mood }) } });
                            }}
                            onMove={by => {
                                const moved = movedOccasion(ids, occasion.id, by);
                                if (moved !== undefined) reorder.mutate({ ids: moved });
                            }}
                            onEdit={() => setEditing(occasion)}
                            onRemove={() => {
                                if (editing?.id === occasion.id) setEditing(undefined);
                                remove.mutate(occasion.id);
                            }}
                        />
                    ))}
                </Stack>
            </Card>

            <OccasionForm
                key={editing?.id ?? 'new'}
                editing={editing}
                calendars={occasions.data?.calendars ?? []}
                onDone={() => setEditing(undefined)}
            />

            <OccasionsImportModal opened={importing} onClose={() => setImporting(false)} />
        </Stack>
    );
}

function OccasionRow({
    occasion,
    first,
    last,
    onToggle,
    onMood,
    onMove,
    onEdit,
    onRemove,
}: {
    occasion: Occasion;
    first: boolean;
    last: boolean;
    onToggle: (enabled: boolean) => void;
    onMood: (mood: Mood | undefined) => void;
    onMove: (by: -1 | 1) => void;
    onEdit: () => void;
    onRemove: () => void;
}) {
    const { t } = useTranslation('schedule');
    const { t: tProgramme } = useTranslation('programme');

    return (
        <Group justify="space-between" wrap="wrap" gap="sm">
            <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 260 }}>
                <Switch
                    checked={occasion.enabled}
                    onChange={event => onToggle(event.currentTarget.checked)}
                    aria-label={t('occasions.toggle', { words: occasion.words })}
                />
                <Stack gap={0}>
                    <Text size="sm" fw={500} c={occasion.enabled ? undefined : 'dimmed'}>
                        {occasion.words}
                    </Text>
                    <Text size="xs" c="dimmed">
                        {occasion.nextDate === undefined
                            ? describeRule(occasion, t)
                            : t('occasions.ruleAndNext', { rule: describeRule(occasion, t), date: formatCivilDate(occasion.nextDate) })}
                    </Text>
                </Stack>
                {occasion.nextDate === undefined ? (
                    <Badge size="sm" variant="light" color="yellow">
                        {t('occasions.ranOut')}
                    </Badge>
                ) : undefined}
            </Group>
            <Group gap={4} wrap="nowrap">
                <Select
                    size="xs"
                    w={130}
                    placeholder={t('occasions.noMood')}
                    aria-label={t('occasions.moodFor', { words: occasion.words })}
                    data={MOODS.map(mood => ({ value: mood, label: tProgramme(`mood.options.${mood}`) }))}
                    value={occasion.mood ?? null}
                    onChange={value => onMood(isMood(value) ? value : undefined)}
                    clearable
                />
                <ActionIcon
                    variant="subtle"
                    color="gray"
                    disabled={first}
                    onClick={() => onMove(-1)}
                    aria-label={t('occasions.moveUp', { words: occasion.words })}
                >
                    <IconArrowUp size={16} />
                </ActionIcon>
                <ActionIcon
                    variant="subtle"
                    color="gray"
                    disabled={last}
                    onClick={() => onMove(1)}
                    aria-label={t('occasions.moveDown', { words: occasion.words })}
                >
                    <IconArrowDown size={16} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="gray" onClick={onEdit} aria-label={t('occasions.edit', { words: occasion.words })}>
                    <IconPencil size={16} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="gray" onClick={onRemove} aria-label={t('occasions.remove', { words: occasion.words })}>
                    <IconTrash size={16} />
                </ActionIcon>
            </Group>
        </Group>
    );
}

function OccasionForm({
    editing,
    calendars,
    onDone,
}: {
    editing: Occasion | undefined;
    calendars: readonly OccasionCalendarMonths[];
    onDone: () => void;
}) {
    const { t } = useTranslation('schedule');
    const add = useAddOccasion();
    const change = useChangeOccasion();
    const [draft, setDraft] = useState<OccasionDraft>(() => (editing === undefined ? BLANK_OCCASION : draftOfOccasion(editing)));
    const set = (part: Partial<OccasionDraft>) => setDraft(current => ({ ...current, ...part }));

    const write = editing === undefined ? add : change;
    const save = () => {
        const occasion = inputOfDraft(draft);
        const done = {
            onSuccess: () => {
                setDraft(BLANK_OCCASION);
                onDone();
            },
        };
        if (editing === undefined) add.mutate(occasion, done);
        else change.mutate({ id: editing.id, occasion }, done);
    };

    return (
        <Card padding="lg">
            <Stack gap="sm">
                <Eyebrow>{editing === undefined ? t('occasions.form.addTitle') : t('occasions.form.editTitle', { words: editing.words })}</Eyebrow>
                {write.isError ? (
                    <ErrorAlert title={t('occasions.failed')}>{apiErrorMessage(write.error, t('occasions.failedFallback'))}</ErrorAlert>
                ) : undefined}

                <Group align="flex-end" gap="sm" wrap="wrap">
                    <TextInput
                        label={t('occasions.form.words')}
                        description={t('occasions.form.wordsHint')}
                        placeholder={t('occasions.form.wordsPlaceholder')}
                        maxLength={80}
                        value={draft.words}
                        onChange={event => set({ words: event.currentTarget.value })}
                        style={{ flex: 1, minWidth: 240 }}
                    />
                    <RuleKindField draft={draft} set={set} />
                </Group>

                <RuleFields draft={draft} calendars={calendars} set={set} />

                <Group gap="sm">
                    <Button disabled={draft.words.trim() === ''} loading={write.isPending} onClick={save}>
                        {editing === undefined ? t('occasions.form.add') : t('occasions.form.save')}
                    </Button>
                    {editing === undefined ? undefined : (
                        <Button variant="default" onClick={onDone}>
                            {t('occasions.form.cancel')}
                        </Button>
                    )}
                </Group>
            </Stack>
        </Card>
    );
}
