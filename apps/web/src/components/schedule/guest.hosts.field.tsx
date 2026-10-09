import { ActionIcon, Button, Chip, Group, InputWrapper, NumberInput, SegmentedControl, Select, Stack, Text } from '@mantine/core';
import { IconPlus, IconX } from '@tabler/icons-react';
import type { SlotGuestHost } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { usePersonas } from '../../api/personas.queries';
import { weekdayShort } from '../../i18n/format.locale';
import { presents } from '../personas/persona.kind';
import { DAYS } from './schedule.day';

/**
 * One guest host as the form holds it. Both halves of WHEN are kept while the row is open, so
 * flipping between "on these nights" and "at random" does not throw away what was typed in the other.
 */
export interface GuestRow {
    personaId: string;
    when: 'days' | 'random';
    days: string[];
    /** Empty string is Mantine's "nothing typed" for a `NumberInput`. */
    everyN: number | string;
    cooldownDays: number | string;
}

/** A stored guest host as a form row. */
export function guestRowOf(guest: SlotGuestHost): GuestRow {
    return {
        personaId: guest.personaId,
        when: guest.everyN === undefined ? 'days' : 'random',
        days: (guest.days ?? []).map(String),
        everyN: guest.everyN ?? 7,
        cooldownDays: guest.cooldownDays ?? '',
    };
}

/**
 * The rows as the API takes them, each saying WHEN in exactly one way. A row with no host chosen is
 * dropped rather than sent, since the API would refuse it and an empty row is an unfinished thought.
 */
export function guestHostsOf(rows: readonly GuestRow[]): SlotGuestHost[] {
    return rows
        .filter(row => row.personaId !== '')
        .map(row =>
            row.when === 'days'
                ? { personaId: row.personaId, days: row.days.map(Number) }
                : {
                      personaId: row.personaId,
                      everyN: typeof row.everyN === 'number' ? row.everyN : 7,
                      ...(typeof row.cooldownDays === 'number' ? { cooldownDays: row.cooldownDays } : {}),
                  },
        );
}

/** What stops a row being saved, as a catalog key, or nothing. */
export function guestRowProblem(row: GuestRow): 'slot.guests.pickHost' | 'slot.guests.pickNights' | undefined {
    if (row.personaId === '') return 'slot.guests.pickHost';
    if (row.when === 'days' && row.days.length === 0) return 'slot.guests.pickNights';

    return undefined;
}

/**
 * Who sits in for the slot's own host, and when.
 *
 * ## Fixed nights, or at random
 *
 * "Rockzo has the Boneyard on Wednesdays" and "Rockzo turns up about once a week" are both real
 * radio, and the second is the one that sounds unscheduled. At random is "about one night in N",
 * with a gap between visits so even an about-weekly guest never lands two nights running; the
 * station works out which nights from the date, so it is a surprise on air and in the console alike.
 *
 * ## Hosts only, and never the slot's own
 *
 * The same narrowing as "Hosted by" (`presents`): a caller rings in and a guest drops by, and
 * neither can present. The slot's own host is left out, since sitting in for yourself is not a night
 * anybody can hear. The API refuses both too; leaving them out of the list is the console not
 * offering a choice that can only fail.
 */
export function GuestHostsField({ rows, onChange, ownHostId, errors }: Props) {
    const { t } = useTranslation('schedule');
    const personas = usePersonas();
    const hosts = (personas.data?.personas ?? []).filter(presents).filter(persona => persona.id !== ownHostId);

    const set = (index: number, change: Partial<GuestRow>) => onChange(rows.map((row, at) => (at === index ? { ...row, ...change } : row)));

    return (
        <InputWrapper label={t('slot.guests.label')} description={t('slot.guests.description')}>
            <Stack gap="sm" mt="xs">
                {rows.map((row, index) => {
                    const taken = new Set(rows.filter((_, at) => at !== index).map(other => other.personaId));
                    const options = hosts.filter(host => !taken.has(host.id)).map(host => ({ value: host.id, label: host.label }));

                    return (
                        <Stack key={index} gap={6}>
                            <Group gap="xs" align="flex-start" wrap="wrap">
                                <Select
                                    aria-label={t('slot.guests.host')}
                                    placeholder={t('slot.guests.host')}
                                    data={options}
                                    value={row.personaId || null}
                                    onChange={value => set(index, { personaId: value ?? '' })}
                                    w={200}
                                    error={errors?.[index] === 'slot.guests.pickHost' ? t('slot.guests.pickHost') : undefined}
                                />
                                <SegmentedControl
                                    aria-label={t('slot.guests.whenLabel')}
                                    data={[
                                        { value: 'days', label: t('slot.guests.onNights') },
                                        { value: 'random', label: t('slot.guests.atRandom') },
                                    ]}
                                    value={row.when}
                                    onChange={value => set(index, { when: value as GuestRow['when'] })}
                                />
                                <ActionIcon
                                    variant="subtle"
                                    color="gray"
                                    aria-label={t('slot.guests.remove')}
                                    onClick={() => onChange(rows.filter((_, at) => at !== index))}
                                    mt={6}
                                >
                                    <IconX size={14} />
                                </ActionIcon>
                            </Group>

                            {row.when === 'days' ? (
                                <Stack gap={4}>
                                    <Chip.Group multiple value={row.days} onChange={days => set(index, { days })}>
                                        <Group gap={4} wrap="wrap">
                                            {DAYS.map(day => (
                                                <Chip key={day} value={String(day)} size="xs" radius="sm">
                                                    {weekdayShort(day)}
                                                </Chip>
                                            ))}
                                        </Group>
                                    </Chip.Group>
                                    {errors?.[index] === 'slot.guests.pickNights' ? (
                                        <Text size="xs" c="red">
                                            {t('slot.guests.pickNights')}
                                        </Text>
                                    ) : undefined}
                                </Stack>
                            ) : (
                                <Group gap="xs" align="flex-end" wrap="wrap">
                                    <NumberInput
                                        label={t('slot.guests.everyN')}
                                        min={2}
                                        max={366}
                                        allowDecimal={false}
                                        w={150}
                                        value={row.everyN}
                                        onChange={everyN => set(index, { everyN })}
                                    />
                                    <NumberInput
                                        label={t('slot.guests.cooldown')}
                                        placeholder={t('slot.guests.cooldownPlaceholder', {
                                            count: Math.floor((typeof row.everyN === 'number' ? row.everyN : 7) / 2),
                                        })}
                                        min={0}
                                        max={366}
                                        allowDecimal={false}
                                        w={190}
                                        value={row.cooldownDays}
                                        onChange={cooldownDays => set(index, { cooldownDays })}
                                    />
                                </Group>
                            )}
                        </Stack>
                    );
                })}

                <Group>
                    <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconPlus size={14} />}
                        onClick={() => onChange([...rows, { personaId: '', when: 'random', days: [], everyN: 7, cooldownDays: '' }])}
                    >
                        {t('slot.guests.add')}
                    </Button>
                </Group>
            </Stack>
        </InputWrapper>
    );
}

interface Props {
    rows: readonly GuestRow[];
    onChange: (rows: GuestRow[]) => void;
    /** The slot's own host, left out of the list. Absent is a slot the station's host presents. */
    ownHostId?: string;
    /** Per row, what stops it being saved, as {@link guestRowProblem} answers. */
    errors?: readonly (ReturnType<typeof guestRowProblem> | undefined)[];
}
