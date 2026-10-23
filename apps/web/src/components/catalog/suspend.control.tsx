import { Anchor, Button, Group, Menu, Text, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { DateTime } from 'luxon';

import { formatClock } from '../../i18n/format.locale';

/** The lengths on offer, in days. The API takes any whole number up to a year. */
const LENGTHS = [
    { days: 1, key: 'day' },
    { days: 7, key: 'week' },
    { days: 30, key: 'month' },
] as const;

const DAY_MS = 24 * 60 * 60_000;

export interface SuspendControlProps {
    /** When the suspension lapses, while one is in force. Absent is not suspended. */
    suspendedUntil?: DateTime;
    onSuspend: (days: number) => void;
    onLift: () => void;
    /** A write is in flight. */
    busy?: boolean;
}

/**
 * Keep an artist, a release or a record off the station for a while, without disliking it.
 *
 * Beside the rating control and deliberately not a fourth segment inside it. That control is one
 * question with three answers, and a suspension is not an answer to it: a liked artist can be
 * suspended for a week and is still liked when the week is up, so the two have to be able to sit
 * side by side.
 *
 * It says how long is LEFT rather than the date, because a week is what was asked for and a
 * timestamp is not what anybody typed. Under a day, it says the time it lapses instead.
 */
export function SuspendControl({ suspendedUntil, onSuspend, onLift, busy = false }: SuspendControlProps) {
    const { t } = useTranslation('catalog');

    if (suspendedUntil !== undefined) {
        const left = suspendedUntil.toMillis() - Date.now();
        const days = Math.ceil(left / DAY_MS);
        return (
            <Group gap="xs" align="baseline" wrap="nowrap">
                <Text size="xs" c="orange.4" style={{ whiteSpace: 'nowrap' }}>
                    {left < DAY_MS ? t('suspend.until', { time: formatClock(suspendedUntil.toJSDate()) }) : t('suspend.for', { count: days })}
                </Text>
                <Anchor component="button" type="button" size="xs" disabled={busy} onClick={onLift}>
                    {t('suspend.lift')}
                </Anchor>
            </Group>
        );
    }

    return (
        <Menu position="bottom-start" withinPortal>
            <Menu.Target>
                <Tooltip label={t('suspend.hint')} multiline maw={280}>
                    <Button variant="subtle" color="gray" size="compact-xs" loading={busy}>
                        {t('suspend.button')}
                    </Button>
                </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
                {LENGTHS.map(length => (
                    <Menu.Item key={length.key} onClick={() => onSuspend(length.days)}>
                        {t(`suspend.${length.key}`)}
                    </Menu.Item>
                ))}
            </Menu.Dropdown>
        </Menu>
    );
}
