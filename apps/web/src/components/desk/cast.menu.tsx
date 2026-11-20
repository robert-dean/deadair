import { useState } from 'react';
import { Button, Menu, Text, Tooltip } from '@mantine/core';
import { IconCast } from '@tabler/icons-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { OutputCastRequest, OutputDevice } from '@deadair/sdk';

import { useOutputCasts, useOutputDevices } from '../../api/outputs.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { useSignedIn } from '../../auth/session.store';

export interface CastMenuProps {
    onStart: (request: OutputCastRequest) => void;
    onStop: (pluginId: string, deviceId: string) => void;
    /** A start or a stop is in flight. */
    busy: boolean;
    /** Drawn as a full button filling its cell, beside the transport, rather than as a quiet link under it. */
    block?: boolean;
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
/**
 * The cell is about 150px at 1440, and Neon sets a button's words in capitals tracked out by 0.08em,
 * which made "On a speaker" 117px against the 95px the default padding left it: Mantine clips a
 * label rather than ending it in an ellipsis, so it read "ON A SPEAK". Even padding buys the label
 * 101px, which "Speakers" and "2 speakers" fit in every theme, and the ellipsis is for whatever does
 * not (a longer word in another language, a count in double figures), whose full form the tooltip
 * and the open menu both carry.
 *
 * `textBox: 'normal'` is what keeps the ellipsis from cutting the tops off the letters. Mantine sets
 * the label `text-box: cap alphabetic`, which trims its box to the cap height, and is harmless there
 * only because its label is `height: 100%`. With the height left to the text and `overflow: hidden`
 * for the ellipsis, the trimmed box was the clip: 10px of a 14px line, and "SPEAKERS" lost its top.
 */
const BLOCK_STYLES = {
    root: { paddingInline: 12 },
    label: { display: 'block', height: 'auto', textBox: 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
} as const;

export function CastMenu({ onStart, onStop, busy, block = false }: CastMenuProps) {
    const { t } = useTranslation('desk');
    const [opened, setOpened] = useState(false);
    // Polled, so gated on the session as the desk's readers are.
    const casts = useOutputCasts(useSignedIn());
    const devices = useOutputDevices(opened);
    const active = casts.data?.casts ?? [];
    const idle = (devices.data?.devices ?? []).filter(device => !device.casting);

    return (
        <Menu opened={opened} onChange={setOpened} position="bottom-end" width={300} withinPortal>
            <Menu.Target>
                <Tooltip label={t('onAir.cast.hint')} multiline maw={320} disabled={opened}>
                    <Button
                        variant={block ? 'default' : 'subtle'}
                        color={block ? undefined : 'gray'}
                        size={block ? 'sm' : 'compact-sm'}
                        h={block ? 36 : undefined}
                        fullWidth={block}
                        loading={busy}
                        leftSection={<IconCast size={14} stroke={1.8} />}
                        styles={block ? BLOCK_STYLES : undefined}
                    >
                        {/* Shorter in a grid cell, which is half a narrow column and cut the long form short. */}
                        {block
                            ? active.length === 0
                                ? t('onAir.cast.short')
                                : t('onAir.cast.shortActive', { count: active.length })
                            : active.length === 0
                              ? t('onAir.cast.button')
                              : t('onAir.cast.buttonActive', { count: active.length })}
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
    // The kind as well as the model, since one television with both Chromecast and DLNA is listed
    // once for each, and the two entries must not look the same.
    const kind = device.protocol === undefined ? undefined : kindLabel(device.protocol, t);
    const detail =
        kind === undefined ? device.model : device.model === undefined ? kind : t('onAir.cast.kindAndModel', { kind, model: device.model });

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
            {detail === undefined ? null : (
                <Text size="xs" c="dimmed">
                    {detail}
                </Text>
            )}
        </Menu.Item>
    ));
}

const KNOWN_KINDS = ['chromecast', 'upnp', 'bluos'] as const;

/** The kind in the console's words, or the plugin's own word for one this console has not heard of. */
function kindLabel(protocol: string, t: TFunction<'desk'>): string {
    return (KNOWN_KINDS as readonly string[]).includes(protocol) ? t(`onAir.cast.kind.${protocol as (typeof KNOWN_KINDS)[number]}`) : protocol;
}
