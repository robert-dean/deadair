import { useState } from 'react';
import { Badge, Button, Card, Group, MultiSelect, NumberInput, SegmentedControl, Select, Stack, TagsInput, Text, TextInput } from '@mantine/core';
import type { BlockRule, ScheduleSlot } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import {
    useAddNeverPlayRule,
    useGenreSteer,
    useNeverPlayRules,
    useRemoveNeverPlayRule,
    useStopSteering,
    useSteerTowardGenres,
} from '../../api/rules.queries';
import { useSchedule } from '../../api/schedule.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { formatClock } from '../../i18n/format.locale';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';

/** How long a lean can be asked for, in hours. The API takes 1 to 24. */
const STEER_HOURS = ['1', '2', '3', '4', '6', '8', '12', '24'];

/** The modes a rule can be limited to, in the order the Programme page offers them everywhere else. */
const RULE_MODES = ['rotation', 'setlist', 'feature'] as const;
type RuleMode = (typeof RULE_MODES)[number];

const isRuleMode = (value: string): value is RuleMode => (RULE_MODES as readonly string[]).includes(value);

/**
 * The two ways an operator shapes what the station chooses beyond the rotation's own rules.
 *
 * A LEAN (the genre steer) makes some genres come up more often for a few hours and never stops the
 * station playing anything else. A RULE (never play) is absolute, like a dislike, for as long as it
 * holds. They share a tab because an operator reaching for one is usually deciding between the two,
 * and they are drawn as separate cards because they are not the same strength of instruction.
 */
export function RulesPanel() {
    return (
        <Stack gap="lg">
            <SteerCard />
            <NeverPlayCard />
        </Stack>
    );
}

function SteerCard() {
    const { t } = useTranslation('schedule');
    const steer = useGenreSteer();
    const start = useSteerTowardGenres();
    const stop = useStopSteering();
    const [genres, setGenres] = useState<string[]>([]);
    const [hours, setHours] = useState('3');

    const current = steer.data?.steer;
    const failure = start.isError
        ? apiErrorMessage(start.error, t('rules.steer.failed'))
        : stop.isError
          ? apiErrorMessage(stop.error, t('rules.steer.failed'))
          : undefined;

    return (
        <Card padding="lg">
            <Stack gap="sm">
                <Eyebrow>{t('rules.steer.title')}</Eyebrow>
                <Text size="sm" c="dimmed">
                    {t('rules.steer.description')}
                </Text>
                {failure ? <ErrorAlert title={t('rules.steer.failed')}>{failure}</ErrorAlert> : undefined}

                {current === undefined ? undefined : (
                    <Group justify="space-between" wrap="nowrap">
                        <Text size="sm">
                            {t('rules.steer.current', { genres: current.genres.join(', '), until: formatClock(current.endsAt.toJSDate()) })}
                        </Text>
                        <Button size="xs" variant="default" loading={stop.isPending} onClick={() => stop.mutate()}>
                            {t('rules.steer.stop')}
                        </Button>
                    </Group>
                )}

                <Group align="flex-end" gap="sm" wrap="wrap">
                    <TagsInput
                        label={t('rules.steer.genresLabel')}
                        placeholder={t('rules.steer.genresPlaceholder')}
                        value={genres}
                        onChange={setGenres}
                        maxTags={20}
                        style={{ flex: 1, minWidth: 240 }}
                    />
                    <Select
                        label={t('rules.steer.hoursLabel')}
                        data={STEER_HOURS}
                        value={hours}
                        onChange={value => setHours(value ?? '3')}
                        w={120}
                        allowDeselect={false}
                    />
                    <Button
                        disabled={genres.length === 0}
                        loading={start.isPending}
                        onClick={() => start.mutate({ genres, hours: Number(hours) }, { onSuccess: () => setGenres([]) })}
                    >
                        {current === undefined ? t('rules.steer.start') : t('rules.steer.replace')}
                    </Button>
                </Group>
            </Stack>
        </Card>
    );
}

function NeverPlayCard() {
    const { t } = useTranslation('schedule');
    const rules = useNeverPlayRules();
    const add = useAddNeverPlayRule();
    const remove = useRemoveNeverPlayRule();
    const [field, setField] = useState<'genre' | 'tag'>('genre');
    const [value, setValue] = useState('');
    const [seasonFrom, setSeasonFrom] = useState('');
    const [seasonTo, setSeasonTo] = useState('');
    const [fromHour, setFromHour] = useState<number | string>('');
    const [untilHour, setUntilHour] = useState<number | string>('');
    const [modes, setModes] = useState<RuleMode[]>([]);
    const [slotIds, setSlotIds] = useState<string[]>([]);
    // The same cached list the schedule grid on this page reads, so offering the blocks costs no
    // second request. A block that is deleted later leaves its id on the rule, which `scopeOf` shows.
    const schedule = useSchedule();
    const slots = schedule.data?.slots ?? [];

    const failure = add.isError
        ? apiErrorMessage(add.error, t('rules.never.addFailed'))
        : remove.isError
          ? apiErrorMessage(remove.error, t('rules.never.removeFailed'))
          : undefined;

    const submit = () => {
        add.mutate(
            {
                field,
                value: value.trim(),
                ...(seasonFrom.trim() === '' || seasonTo.trim() === '' ? {} : { seasonFrom: seasonFrom.trim(), seasonTo: seasonTo.trim() }),
                ...(typeof fromHour === 'number' && typeof untilHour === 'number' ? { fromHour, untilHour } : {}),
                // Sent only when something was chosen: an empty list means "every one" to the API as
                // well, but an absent field is the shape every unscoped rule already has.
                ...(modes.length === 0 ? {} : { modes }),
                ...(slotIds.length === 0 ? {} : { slotIds }),
            },
            {
                onSuccess: () => {
                    setValue('');
                    setSeasonFrom('');
                    setSeasonTo('');
                    setFromHour('');
                    setUntilHour('');
                    setModes([]);
                    setSlotIds([]);
                },
            },
        );
    };

    return (
        <Card padding="lg">
            <Stack gap="sm">
                <Eyebrow>{t('rules.never.title')}</Eyebrow>
                <Text size="sm" c="dimmed">
                    {t('rules.never.description')}
                </Text>
                {rules.isError ? <ErrorAlert title={t('rules.never.readFailed')} error={rules.error} /> : undefined}
                {failure ? <ErrorAlert title={t('rules.never.writeFailed')}>{failure}</ErrorAlert> : undefined}

                {rules.data !== undefined && rules.data.rules.length === 0 ? <EmptyState>{t('rules.never.empty')}</EmptyState> : undefined}
                {(rules.data?.rules ?? []).map(rule => (
                    <Group key={rule.id} justify="space-between" wrap="nowrap">
                        <Stack gap={2}>
                            <Group gap="xs">
                                <Badge size="sm" variant="light" color="gray">
                                    {rule.field === 'genre' ? t('rules.never.field.genre') : t('rules.never.field.tag')}
                                </Badge>
                                <Text size="sm" fw={500}>
                                    {rule.value}
                                </Text>
                                <Badge size="sm" variant="light" color={rule.inForce ? 'red' : 'gray'}>
                                    {rule.inForce ? t('rules.never.inForce') : t('rules.never.notNow')}
                                </Badge>
                            </Group>
                            <Text size="xs" c="dimmed">
                                {scopeOf(rule, slots, t)}
                            </Text>
                        </Stack>
                        <Button size="xs" variant="default" disabled={remove.isPending} onClick={() => remove.mutate(rule.id)}>
                            {t('rules.never.remove')}
                        </Button>
                    </Group>
                ))}

                <Stack gap="xs" pt="sm" style={{ borderTop: '1px solid var(--da-border)' }}>
                    <Group align="flex-end" gap="sm" wrap="wrap">
                        <SegmentedControl
                            value={field}
                            onChange={next => setField(next === 'tag' ? 'tag' : 'genre')}
                            data={[
                                { value: 'genre', label: t('rules.never.field.genre') },
                                { value: 'tag', label: t('rules.never.field.tag') },
                            ]}
                        />
                        <TextInput
                            label={field === 'genre' ? t('rules.never.valueGenre') : t('rules.never.valueTag')}
                            value={value}
                            onChange={event => setValue(event.currentTarget.value)}
                            style={{ flex: 1, minWidth: 200 }}
                        />
                    </Group>
                    <Text size="xs" c="dimmed">
                        {field === 'genre' ? t('rules.never.genreHint') : t('rules.never.tagHint')}
                    </Text>
                    <Group align="flex-end" gap="sm" wrap="wrap">
                        <TextInput
                            label={t('rules.never.seasonFrom')}
                            placeholder="12-01"
                            value={seasonFrom}
                            onChange={event => setSeasonFrom(event.currentTarget.value)}
                            w={110}
                        />
                        <TextInput
                            label={t('rules.never.seasonTo')}
                            placeholder="01-06"
                            value={seasonTo}
                            onChange={event => setSeasonTo(event.currentTarget.value)}
                            w={110}
                        />
                        <NumberInput
                            label={t('rules.never.fromHour')}
                            min={0}
                            max={23}
                            allowDecimal={false}
                            value={fromHour}
                            onChange={setFromHour}
                            w={110}
                        />
                        <NumberInput
                            label={t('rules.never.untilHour')}
                            min={0}
                            max={24}
                            allowDecimal={false}
                            value={untilHour}
                            onChange={setUntilHour}
                            w={110}
                        />
                    </Group>
                    <Group align="flex-end" gap="sm" wrap="wrap">
                        <MultiSelect
                            label={t('rules.never.modesLabel')}
                            placeholder={modes.length === 0 ? t('rules.never.modesPlaceholder') : undefined}
                            data={RULE_MODES.map(mode => ({ value: mode, label: t(`rules.never.mode.${mode}`) }))}
                            value={modes}
                            onChange={next => setModes(next.filter(isRuleMode))}
                            clearable
                            style={{ flex: 1, minWidth: 200 }}
                        />
                        <MultiSelect
                            label={t('rules.never.slotsLabel')}
                            placeholder={slotIds.length === 0 ? t('rules.never.slotsPlaceholder') : undefined}
                            data={slots.map(slot => ({ value: slot.id, label: slot.label }))}
                            value={slotIds}
                            onChange={setSlotIds}
                            nothingFoundMessage={t('rules.never.slotsNone')}
                            searchable
                            clearable
                            style={{ flex: 1, minWidth: 200 }}
                        />
                        <Button disabled={value.trim() === ''} loading={add.isPending} onClick={submit}>
                            {t('rules.never.add')}
                        </Button>
                    </Group>
                    <Text size="xs" c="dimmed">
                        {t('rules.never.scopeHint')}
                    </Text>
                </Stack>
            </Stack>
        </Card>
    );
}

/**
 * When a rule holds, in a sentence, or "always" for one with no scope.
 *
 * A block is named by its label. One that has since been deleted is shown by its id rather than
 * dropped: the rule still names it, so it still limits the rule (to a block that never comes on).
 */
function scopeOf(rule: BlockRule, slots: readonly ScheduleSlot[], t: TFunction<'schedule'>): string {
    const parts: string[] = [];
    if (rule.seasonFrom !== undefined && rule.seasonTo !== undefined)
        parts.push(t('rules.never.scope.season', { from: rule.seasonFrom, to: rule.seasonTo }));
    if (rule.fromHour !== undefined && rule.untilHour !== undefined)
        parts.push(t('rules.never.scope.hours', { from: rule.fromHour, until: rule.untilHour }));
    if (rule.modes !== undefined && rule.modes.length > 0)
        parts.push(t('rules.never.scope.modes', { modes: rule.modes.map(mode => t(`rules.never.mode.${mode}`)).join(', ') }));
    if (rule.slotIds !== undefined && rule.slotIds.length > 0) {
        const names = rule.slotIds.map(id => slots.find(slot => slot.id === id)?.label ?? id);
        parts.push(t('rules.never.scope.slots', { slots: names.join(', ') }));
    }
    if (rule.endsAt !== undefined) parts.push(t('rules.never.scope.until', { until: formatClock(rule.endsAt.toJSDate()) }));
    return parts.length === 0 ? t('rules.never.scope.always') : parts.join(' · ');
}
