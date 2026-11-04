import { Card, Stack, Table, Text } from '@mantine/core';
import type { ScheduleSlot } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { Eyebrow } from '../shared/eyebrow';
import { RowOpener } from '../shared/row.opener';
import { formatWallTime } from '../../i18n/format.locale';

/**
 * Slots kept but not running, weekly ones and specials alike.
 *
 * The grid draws what the station will do and a switched-off slot is not that, so without this it would be
 * a show nobody could find to turn back on. It is where an imported schedule lands, too. Drawn only when
 * there is something in it, since most stations will never switch a slot off.
 */
export function SwitchedOffPanel({ slots, onEdit }: { slots: readonly ScheduleSlot[]; onEdit: (slot: ScheduleSlot) => void }) {
    const { t } = useTranslation('schedule');
    if (slots.length === 0) return null;

    return (
        <Card padding="lg">
            <Stack gap="sm">
                <Eyebrow>{t('switchedOff.title')}</Eyebrow>
                <Text size="sm" c="dimmed" maw={620}>
                    {t('switchedOff.description')}
                </Text>
                <Table.ScrollContainer minWidth={420}>
                    <Table verticalSpacing="xs">
                        <Table.Tbody>
                            {slots.map(slot => {
                                const name = slot.label || t('untitled');
                                return (
                                    <Table.Tr
                                        key={slot.id}
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => onEdit(slot)}
                                        aria-label={t('switchedOff.edit', { name })}
                                    >
                                        <Table.Td w={150} className="da-num">
                                            <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                                                {t('specials.hours', { from: wallTime(slot.startsAtMinutes), until: wallTime(slot.endsAtMinutes) })}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <RowOpener>
                                                <Text size="sm" fw={500}>
                                                    {name}
                                                </Text>
                                            </RowOpener>
                                        </Table.Td>
                                    </Table.Tr>
                                );
                            })}
                        </Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
            </Stack>
        </Card>
    );
}

function wallTime(minutes: number): string {
    return formatWallTime(Math.floor(minutes / 60), minutes % 60);
}
