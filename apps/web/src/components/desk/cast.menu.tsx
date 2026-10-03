import { useState } from 'react';
import { Button, Menu, Text, Tooltip } from '@mantine/core';
import { IconCast } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { OutputCastRequest, OutputDevice } from '@deadair/sdk';

import { useOutputCasts, useOutputDevices } from '../../api/outputs.queries';
import { apiErrorMessage } from '../../api/sdk.error';

export interface CastMenuProps {
    onStart: (request: OutputCastRequest) => void;
    onStop: (pluginId: string, deviceId: string) => void;
    /** A start or a stop is in flight. */
    busy: boolean;
}

/**
 * "Play on a speaker": the speakers the station is playing on, and the ones it could.
 *
 * A menu under the transport rather than a panel of its own, because it is a control the operator
 * reaches for now and then, and the desk's column is the one place on the page that does not move.
 * The speaker list is only asked for when the menu opens: listing them is a question to every
 * output plugin, and nothing on the desk needs the answer until then. The casts are polled, since
 * the button says how many speakers are playing.
 *
 * The mutations belong to the card, so a failure lands in the card's own stack of failures rather
 * than inside a menu that has closed by the time it arrives.
 */
export function CastMenu({ onStart, onStop, busy }: CastMenuProps) {
    const { t } = useTranslation('desk');
    const [opened, setOpened] = useState(false);
    const casts = useOutputCasts(true);
    const devices = useOutputDevices(opened);
    const active = casts.data?.casts ?? [];
    const idle = (devices.data?.devices ?? []).filter(device => !device.casting);

    return (
        <Menu opened={opened} onChange={setOpened} position="bottom-end" width={300} withinPortal>
            <Menu.Target>
                <Tooltip label={t('onAir.cast.hint')} multiline maw={320} disabled={opened}>
                    <Button variant="subtle" color="gray" size="compact-sm" loading={busy} leftSection={<IconCast size={14} stroke={1.8} />}>
                        {active.length === 0 ? t('onAir.cast.button') : t('onAir.cast.buttonActive', { count: active.length })}
                    </Button>
                </Tooltip>
            </Menu.Target>

            <Menu.Dropdown>
                {active.length > 0 && (
                    <>
                        <Menu.Label>{t('onAir.cast.playingOn')}</Menu.Label>
                        {active.map(cast => (
                            <Menu.Item
                                key={`${cast.pluginId}/${cast.deviceId}`}
                                onClick={() => onStop(cast.pluginId, cast.deviceId)}
                                rightSection={
                                    <Text size="xs" c="red">
                                        {t('onAir.cast.stop')}
                                    </Text>
                                }
                            >
                                <Text size="sm">{cast.deviceName}</Text>
                                <Text size="xs" c="dimmed">
                                    {cast.detail === undefined
                                        ? t(`onAir.cast.phase.${cast.phase}`)
                                        : `${t(`onAir.cast.phase.${cast.phase}`)}: ${cast.detail}`}
                                </Text>
                            </Menu.Item>
                        ))}
                        <Menu.Divider />
                    </>
                )}

                {/* The heading only over something: with every speaker already playing, it would
                    head an empty section under the ones above. */}
                {(devices.isPending || devices.isError || idle.length > 0 || active.length === 0) && (
                    <Menu.Label>{t('onAir.cast.available')}</Menu.Label>
                )}
                {devices.isPending ? (
                    <Text size="sm" c="dimmed" px="sm" py={6}>
                        {t('onAir.cast.loading')}
                    </Text>
                ) : devices.isError ? (
                    <Text size="sm" c="red" px="sm" py={6}>
                        {apiErrorMessage(devices.error, t('onAir.cast.listFailed'))}
                    </Text>
                ) : idle.length === 0 ? (
                    active.length === 0 && (
                        <Text size="sm" c="dimmed" px="sm" py={6}>
                            {t('onAir.cast.none')}
                        </Text>
                    )
                ) : (
                    idle.map(device => <DeviceItems key={`${device.pluginId}/${device.deviceId}`} device={device} onStart={onStart} />)
                )}

                {devices.data?.discoverySeesNothing === true && (
                    <Text size="xs" c="dimmed" px="sm" py={4}>
                        {t('onAir.cast.cannotLook')}
                    </Text>
                )}

                {devices.data?.problems.map(problem => (
                    <Text key={problem.pluginId} size="xs" c="dimmed" px="sm" py={4}>
                        {t('onAir.cast.problem', { plugin: problem.pluginId })}
                    </Text>
                ))}
            </Menu.Dropdown>
        </Menu>
    );
}

/** One speaker: a single item when it plays one of the station's mounts, one per mount when it plays several. */
function DeviceItems({ device, onStart }: { device: OutputDevice; onStart: CastMenuProps['onStart'] }) {
    const { t } = useTranslation('desk');

    if (device.mounts.length === 0) {
        return (
            <Menu.Item disabled>
                <Text size="sm">{device.name}</Text>
                <Text size="xs" c="dimmed">
                    {t('onAir.cast.noMounts')}
                </Text>
            </Menu.Item>
        );
    }

    return device.mounts.map(mount => (
        <Menu.Item
            key={mount.path}
            onClick={() => onStart({ pluginId: device.pluginId, deviceId: device.deviceId, mountPath: mount.path })}
            rightSection={
                device.mounts.length > 1 ? (
                    <Text size="xs" c="dimmed">
                        {t(`onAir.cast.format.${mount.format}`)}
                    </Text>
                ) : undefined
            }
        >
            <Text size="sm">{device.name}</Text>
            {device.model === undefined ? null : (
                <Text size="xs" c="dimmed">
                    {device.model}
                </Text>
            )}
        </Menu.Item>
    ));
}
