import { Group, NumberInput, Select, Text, Textarea } from '@mantine/core';
import type { OccasionCalendarMonths } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { monthLong, weekdayLong } from '../../i18n/format.locale';
import type { RuleDraft } from './occasions.edits';

const RULE_KINDS: readonly RuleDraft['ruleKind'][] = ['fixed', 'weekday', 'easter', 'calendar', 'dates'];
const ORDINALS = [
    { value: '1', key: 'n1' },
    { value: '2', key: 'n2' },
    { value: '3', key: 'n3' },
    { value: '4', key: 'n4' },
    { value: '5', key: 'n5' },
    { value: '-1', key: 'last' },
] as const;
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const WEEKDAYS = Array.from({ length: 7 }, (_, index) => index);

/**
 * Saying when something falls: which kind of rule, and that kind's own fields.
 *
 * An occasion and a special on a rule fall by the same rules, so they ask them the same way. Two
 * pieces rather than one, because a form puts the choice of kind where it has room for it.
 */
export function RuleKindField({ draft, set }: { draft: Pick<RuleDraft, 'ruleKind'>; set: (part: Partial<RuleDraft>) => void }) {
    const { t } = useTranslation('schedule');

    return (
        <Select
            label={t('occasions.form.kind')}
            w={230}
            allowDeselect={false}
            data={RULE_KINDS.map(kind => ({ value: kind, label: t(`occasions.kinds.${kind}`) }))}
            value={draft.ruleKind}
            onChange={value => set({ ruleKind: value as RuleDraft['ruleKind'] })}
        />
    );
}

/** The fields the chosen kind reads, and the one thing worth knowing about the calendar it reads them in. */
export function RuleFields({
    draft,
    calendars,
    set,
}: {
    draft: RuleDraft;
    calendars: readonly OccasionCalendarMonths[];
    set: (part: Partial<RuleDraft>) => void;
}) {
    const { t } = useTranslation('schedule');
    const months = calendars.find(calendar => calendar.calendar === draft.calendar)?.months ?? [];

    const monthField = (
        <Select
            label={t('occasions.form.month')}
            w={150}
            allowDeselect={false}
            data={MONTHS.map(month => ({ value: String(month), label: monthLong(month) }))}
            value={String(draft.month)}
            onChange={value => set({ month: Number(value) })}
        />
    );
    const dayField = (
        <NumberInput label={t('occasions.form.day')} w={90} min={1} max={31} value={draft.day} onChange={value => set({ day: Number(value) || 1 })} />
    );

    return (
        <>
            <Group align="flex-end" gap="sm" wrap="wrap">
                {draft.ruleKind === 'fixed' ? (
                    <>
                        {monthField}
                        {dayField}
                    </>
                ) : undefined}
                {draft.ruleKind === 'weekday' ? (
                    <>
                        <Select
                            label={t('occasions.form.which')}
                            w={110}
                            allowDeselect={false}
                            data={ORDINALS.map(ordinal => ({ value: ordinal.value, label: t(`occasions.ordinals.${ordinal.key}`) }))}
                            value={String(draft.ordinal)}
                            onChange={value => set({ ordinal: Number(value) })}
                        />
                        <Select
                            label={t('occasions.form.weekday')}
                            w={150}
                            allowDeselect={false}
                            data={WEEKDAYS.map(day => ({ value: String(day), label: weekdayLong(day) }))}
                            value={String(draft.weekday)}
                            onChange={value => set({ weekday: Number(value) })}
                        />
                        {monthField}
                    </>
                ) : undefined}
                {draft.ruleKind === 'easter' ? (
                    <NumberInput
                        label={t('occasions.form.offset')}
                        description={t('occasions.form.offsetHint')}
                        w={260}
                        min={-60}
                        max={60}
                        value={draft.offsetDays}
                        onChange={value => set({ offsetDays: Number(value) || 0 })}
                    />
                ) : undefined}
                {draft.ruleKind === 'calendar' ? (
                    <>
                        <Select
                            label={t('occasions.form.calendar')}
                            w={190}
                            allowDeselect={false}
                            data={calendars.map(({ calendar }) => ({ value: calendar, label: t(`occasions.calendars.${calendar}`) }))}
                            value={draft.calendar}
                            onChange={value => set({ calendar: value as RuleDraft['calendar'], calendarMonth: '' })}
                        />
                        <Select
                            label={t('occasions.form.month')}
                            w={170}
                            allowDeselect={false}
                            data={[...months]}
                            value={draft.calendarMonth === '' ? null : draft.calendarMonth}
                            onChange={value => set({ calendarMonth: value ?? '' })}
                        />
                        {dayField}
                    </>
                ) : undefined}
                {draft.ruleKind === 'dates' ? (
                    <Textarea
                        label={t('occasions.form.dates')}
                        description={t('occasions.form.datesHint')}
                        placeholder={t('occasions.form.datesPlaceholder')}
                        autosize
                        minRows={3}
                        value={draft.dates}
                        onChange={event => set({ dates: event.currentTarget.value })}
                        style={{ flex: 1, minWidth: 240 }}
                    />
                ) : undefined}
            </Group>

            {draft.ruleKind === 'calendar' && draft.calendar === 'islamic-umalqura' ? (
                <Text size="xs" c="dimmed">
                    {t('occasions.form.sightedMoon')}
                </Text>
            ) : undefined}
        </>
    );
}
