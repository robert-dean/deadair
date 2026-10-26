import { useState } from 'react';
import { Anchor, Button, Card, Group, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { PlayoutLive } from '@deadair/sdk';

import { useArmLive, useDisarmLive } from '../../api/playout.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { useSettings } from '../../api/settings.queries';
import { ErrorAlert } from '../shared/error.alert';
import { formatDuration } from '../shared/format.duration';
import { StatusLamp } from '../shared/status.lamp';
import { usePhone } from '../shared/use.phone';
import { useArmedPress } from './armed.press';
import { useLiveClock } from './live.clock';

/** The setting that says what the station's own programme does while somebody is live. */
const LIVE_AUTOMATION_KEY = 'playout.liveAutomation';

export interface LiveInputProps {
    /** The live input as the station last reported it. */
    live: PlayoutLive;
}

/**
 * Going live, and handing back, from the desk.
 *
 * A card of its own under On air now rather than more controls in it: that panel's control column is
 * a fixed width for Stop's sake (see `on.air.now.tsx`), and this card has to grow from one row when
 * nobody is live to a countdown somebody reads from across the room.
 *
 * Go live is one press, because arming airs nothing: the presenter is on only once their encoder is
 * sending real sound, after a countdown. Hand back cuts a presenter off for everybody listening, so it
 * asks twice, as Stop does.
 */
export function LiveInput({ live }: LiveInputProps) {
    const { t } = useTranslation('desk');
    const phone = usePhone();
    const [name, setName] = useState('');
    const arm = useArmLive();
    const disarm = useDisarmLive();
    const handBack = useArmedPress(() => disarm.mutate());
    const clock = useLiveClock(live);

    const failures = [
        arm.isError ? apiErrorMessage(arm.error, t('live.goLiveFailed')) : undefined,
        disarm.isError ? apiErrorMessage(disarm.error, live.state === 'onair' ? t('live.handBackFailed') : t('live.cancelFailed')) : undefined,
    ].filter((message): message is string => message !== undefined);

    const onAir = live.state === 'onair';

    return (
        <Stack gap="sm">
            <Card
                withBorder
                padding="md"
                // The tally rule again, and for the same reason as On air now's: red means a person is
                // on the air, so it is drawn only then.
                style={{ borderTop: `2px solid ${onAir ? 'var(--mantine-color-red-6)' : 'var(--da-border)'}` }}
            >
                <Group justify="space-between" align="center" wrap={phone ? 'wrap' : 'nowrap'} gap="md">
                    <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="sm" wrap="nowrap">
                            <Text size="xs" fw={600} tt="uppercase" ff="monospace" c="dimmed" style={{ letterSpacing: 'var(--da-tracking-eyebrow)' }}>
                                {t('live.title')}
                            </Text>
                            {live.state === 'armed' ? <StatusLamp tone="standby" label={t('live.armed.lamp')} /> : undefined}
                            {live.state === 'preroll' ? <StatusLamp tone="fault" label={t('live.preroll.lamp')} /> : undefined}
                            {onAir ? <StatusLamp tone="live" emphasis="chip" pulse label={t('live.onair.lamp')} /> : undefined}
                        </Group>
                        {live.state === 'off' ? <AutomationLine /> : undefined}
                        {live.state === 'armed' ? <Text size="sm">{t('live.armed.waiting')}</Text> : undefined}
                        {live.state === 'preroll' ? <Countdown inMs={clock.inMs} /> : undefined}
                        {onAir && clock.forMs !== undefined ? (
                            <Text size="sm" c="dimmed" className="da-num">
                                {t('live.onair.for', { time: formatDuration(clock.forMs) })}
                            </Text>
                        ) : undefined}
                    </Stack>

                    {live.state === 'off' ? (
                        <Group gap="xs" wrap="nowrap" w={phone ? '100%' : undefined} align="flex-end">
                            <TextInput
                                label={t('live.off.nameLabel')}
                                description={phone ? undefined : t('live.off.nameHint')}
                                value={name}
                                onChange={event => setName(event.currentTarget.value)}
                                maxLength={200}
                                style={{ flex: 1 }}
                                w={phone ? undefined : 240}
                            />
                            <Tooltip label={t('live.off.goLiveHint')} multiline maw={320}>
                                <Button h={36} loading={arm.isPending} onClick={() => arm.mutate(name)}>
                                    {t('live.off.goLive')}
                                </Button>
                            </Tooltip>
                        </Group>
                    ) : undefined}

                    {live.state === 'armed' || live.state === 'preroll' ? (
                        <Button variant="default" h={36} loading={disarm.isPending} onClick={() => disarm.mutate()}>
                            {t('live.armed.cancel')}
                        </Button>
                    ) : undefined}

                    {onAir ? (
                        <Tooltip label={handBack.armed ? t('live.onair.handBackArmedHint') : t('live.onair.handBackHint')} multiline maw={320}>
                            {/* Filled once armed, as Stop is, so the state reads across the room. */}
                            <Button
                                color="red"
                                variant={handBack.armed ? 'filled' : 'outline'}
                                h={44}
                                w={phone ? '100%' : 170}
                                loading={disarm.isPending}
                                onClick={handBack.press}
                            >
                                {handBack.armed ? t('live.onair.confirmHandBack') : t('live.onair.handBack')}
                            </Button>
                        </Tooltip>
                    ) : undefined}
                </Group>
            </Card>

            {failures.map(message => (
                <ErrorAlert key={message}>{message}</ErrorAlert>
            ))}
        </Stack>
    );
}

/**
 * The count in: three, two, one, in digits big enough to read from the far side of a studio.
 *
 * The presenter is waiting on this and nothing else, so it is the largest thing on the desk while it
 * runs. The whole seconds still to go, rounded up, so it reads 3 the moment it starts and never shows
 * 0 before the cut. Announced politely to a screen reader once a second rather than ten times.
 */
function Countdown({ inMs }: { inMs: number | undefined }) {
    const { t } = useTranslation('desk');
    if (inMs === undefined) return <Text size="sm">{t('live.preroll.counting')}</Text>;

    const seconds = Math.max(1, Math.ceil(inMs / 1000));
    return (
        <Group gap="md" align="baseline" wrap="nowrap" aria-live="polite">
            <Text fz={64} lh={1} fw={700} ff="heading" c="orange.4" className="da-num">
                {seconds}
            </Text>
            <Text size="sm">{t('live.preroll.in', { count: seconds })}</Text>
        </Group>
    );
}

/**
 * What the station's own programme will do while somebody is live, said before they go rather than
 * found out after, with the way to change it beside it. Nothing while the settings have not loaded:
 * a guess here would be a promise about the station that the setting might not keep.
 */
function AutomationLine() {
    const { t } = useTranslation('desk');
    const settings = useSettings();
    const value = settings.data?.values[LIVE_AUTOMATION_KEY];
    if (value === undefined) return undefined;

    return (
        <Text size="sm" c="dimmed">
            {value === 'continue' ? t('live.off.continue') : t('live.off.standDown')}{' '}
            <Anchor size="sm" renderRoot={(props: object) => <Link to="/settings/playout" {...props} />}>
                {t('live.off.change')}
            </Anchor>
        </Text>
    );
}
