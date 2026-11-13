import { useState } from 'react';
import { ActionIcon, Badge, Button, Card, Group, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconPencil, IconTrash } from '@tabler/icons-react';
import type { Festival } from '@deadair/sdk';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useAddFestival, useChangeFestival, useFestivals, useRemoveFestival } from '../../api/festivals.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { formatCivilDate } from '../../i18n/format.locale';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { BLANK_FESTIVAL, canSaveFestival, draftOfFestival, inputOfFestivalDraft, type FestivalDraft } from './festivals.edits';

/** The colour a festival's state is drawn in: on now is the live tally, still to come is quiet, over is spent. */
const STATE_COLOR = { on: 'red', upcoming: 'blue', over: 'gray' } as const satisfies Record<Festival['state'], string>;

/**
 * The festivals a show can be built around: their dates, where they are, and who is on the bill.
 *
 * A list rather than anything on the timetable, because a festival is not a show. A slot names one (on
 * its editor, usually a special covering the run-up and the weekend), and that show then plays the bill
 * and its host may talk about the festival from what is written here.
 */
export function FestivalsPanel() {
    const { t } = useTranslation('schedule');
    const festivals = useFestivals();
    const remove = useRemoveFestival();
    const [editing, setEditing] = useState<Festival | undefined>();

    const rows = festivals.data?.festivals ?? [];

    return (
        <Stack gap="lg">
            <Card padding="lg">
                <Stack gap="sm">
                    <Eyebrow>{t('festivals.title')}</Eyebrow>
                    <Text size="sm" c="dimmed">
                        {t('festivals.description')}
                    </Text>
                    {festivals.isError ? (
                        <ErrorAlert title={t('festivals.loadFailed')}>
                            {apiErrorMessage(festivals.error, t('festivals.loadFailedFallback'))}
                        </ErrorAlert>
                    ) : undefined}
                    {remove.isError ? (
                        <ErrorAlert title={t('festivals.failed')}>{apiErrorMessage(remove.error, t('festivals.failedFallback'))}</ErrorAlert>
                    ) : undefined}
                    {festivals.isSuccess && rows.length === 0 ? (
                        <EmptyState title={t('festivals.emptyTitle')}>{t('festivals.empty')}</EmptyState>
                    ) : undefined}

                    {rows.map(festival => (
                        <FestivalRow
                            key={festival.id}
                            festival={festival}
                            onEdit={() => setEditing(festival)}
                            onRemove={() => {
                                if (editing?.id === festival.id) setEditing(undefined);
                                remove.mutate(festival.id);
                            }}
                        />
                    ))}
                </Stack>
            </Card>

            <FestivalForm key={editing?.id ?? 'new'} editing={editing} onDone={() => setEditing(undefined)} />
        </Stack>
    );
}

/** The dates as the console says them: one day, or the first and the last. */
export function festivalDates(festival: Pick<Festival, 'startsOn' | 'endsOn'>, t: TFunction<'schedule'>): string {
    return festival.startsOn === festival.endsOn
        ? formatCivilDate(festival.startsOn)
        : t('festivals.range', { from: formatCivilDate(festival.startsOn), to: formatCivilDate(festival.endsOn) });
}

function FestivalRow({ festival, onEdit, onRemove }: { festival: Festival; onEdit: () => void; onRemove: () => void }) {
    const { t } = useTranslation('schedule');
    const headliners = festival.acts.filter(act => act.headliner === true).map(act => act.artist);

    return (
        <Group justify="space-between" wrap="wrap" gap="sm">
            <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 260 }}>
                <Stack gap={0}>
                    <Text size="sm" fw={500} c={festival.state === 'over' ? 'dimmed' : undefined}>
                        {festival.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                        {festival.place === undefined
                            ? festivalDates(festival, t)
                            : t('festivals.datesAndPlace', { dates: festivalDates(festival, t), place: festival.place })}
                    </Text>
                    <Text size="xs" c="dimmed">
                        {headliners.length === 0
                            ? t('festivals.bill', { count: festival.acts.length })
                            : t('festivals.billHeadlined', { count: festival.acts.length, headliners: headliners.join(', ') })}
                    </Text>
                </Stack>
                <Badge size="sm" variant="light" color={STATE_COLOR[festival.state]}>
                    {t(`festivals.state.${festival.state}`)}
                </Badge>
            </Group>
            <Group gap={4} wrap="nowrap">
                <ActionIcon variant="subtle" color="gray" onClick={onEdit} aria-label={t('festivals.edit', { name: festival.name })}>
                    <IconPencil size={16} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="gray" onClick={onRemove} aria-label={t('festivals.remove', { name: festival.name })}>
                    <IconTrash size={16} />
                </ActionIcon>
            </Group>
        </Group>
    );
}

function FestivalForm({ editing, onDone }: { editing: Festival | undefined; onDone: () => void }) {
    const { t } = useTranslation('schedule');
    const add = useAddFestival();
    const change = useChangeFestival();
    const [draft, setDraft] = useState<FestivalDraft>(() => (editing === undefined ? BLANK_FESTIVAL : draftOfFestival(editing)));
    const set = (part: Partial<FestivalDraft>) => setDraft(current => ({ ...current, ...part }));

    const write = editing === undefined ? add : change;
    const save = () => {
        const festival = inputOfFestivalDraft(draft);
        const done = {
            onSuccess: () => {
                setDraft(BLANK_FESTIVAL);
                onDone();
            },
        };
        if (editing === undefined) add.mutate(festival, done);
        else change.mutate({ id: editing.id, festival }, done);
    };

    return (
        <Card padding="lg">
            <Stack gap="sm">
                <Eyebrow>{editing === undefined ? t('festivals.form.addTitle') : t('festivals.form.editTitle', { name: editing.name })}</Eyebrow>
                {write.isError ? (
                    <ErrorAlert title={t('festivals.failed')}>{apiErrorMessage(write.error, t('festivals.failedFallback'))}</ErrorAlert>
                ) : undefined}

                <Group align="flex-start" gap="sm" wrap="wrap">
                    <TextInput
                        label={t('festivals.form.name')}
                        description={t('festivals.form.nameHint')}
                        maxLength={120}
                        value={draft.name}
                        onChange={event => set({ name: event.currentTarget.value })}
                        style={{ flex: 1, minWidth: 240 }}
                    />
                    <DatePickerInput
                        type="range"
                        allowSingleDateInRange
                        label={t('festivals.form.dates')}
                        description={t('festivals.form.datesHint')}
                        valueFormat="D MMM YYYY"
                        // No weekend colouring, as on the specials: red is the on-air tally here.
                        weekendDays={[]}
                        miw={240}
                        value={[draft.startsOn === '' ? null : draft.startsOn, draft.endsOn === '' ? null : draft.endsOn]}
                        onChange={dates => set({ startsOn: dates[0] ?? '', endsOn: dates[1] ?? '' })}
                    />
                </Group>

                <Group align="flex-start" gap="sm" wrap="wrap">
                    <TextInput
                        label={t('festivals.form.place')}
                        description={t('festivals.form.placeHint')}
                        maxLength={200}
                        value={draft.place}
                        onChange={event => set({ place: event.currentTarget.value })}
                        style={{ flex: 1, minWidth: 240 }}
                    />
                    <TextInput
                        label={t('festivals.form.url')}
                        description={t('festivals.form.urlHint')}
                        maxLength={2000}
                        value={draft.url}
                        onChange={event => set({ url: event.currentTarget.value })}
                        style={{ flex: 1, minWidth: 240 }}
                    />
                </Group>

                <Group align="flex-start" gap="sm" wrap="wrap">
                    <Textarea
                        label={t('festivals.form.headliners')}
                        description={t('festivals.form.headlinersHint')}
                        autosize
                        minRows={3}
                        value={draft.headliners}
                        onChange={event => set({ headliners: event.currentTarget.value })}
                        style={{ flex: 1, minWidth: 240 }}
                    />
                    <Textarea
                        label={t('festivals.form.acts')}
                        description={t('festivals.form.actsHint')}
                        autosize
                        minRows={3}
                        value={draft.acts}
                        onChange={event => set({ acts: event.currentTarget.value })}
                        style={{ flex: 1, minWidth: 240 }}
                    />
                </Group>

                <Group gap="sm">
                    <Button disabled={!canSaveFestival(draft)} loading={write.isPending} onClick={save}>
                        {editing === undefined ? t('festivals.form.add') : t('festivals.form.save')}
                    </Button>
                    {editing === undefined ? undefined : (
                        <Button variant="default" onClick={onDone}>
                            {t('festivals.form.cancel')}
                        </Button>
                    )}
                </Group>
            </Stack>
        </Card>
    );
}
