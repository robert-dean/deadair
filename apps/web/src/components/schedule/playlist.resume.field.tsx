import { Button, Group, Stack, Switch, Text } from '@mantine/core';
import type { GetInputPropsReturnType } from '@mantine/form';
import { useTranslation } from 'react-i18next';

import { useRestartSlotPlaylist, useSlotPlaylistPosition } from '../../api/schedule.queries';

/**
 * Whether a playlist slot picks its playlist up where it left off, and where that is.
 *
 * Drawn only under a playlist, the station's own or a provider's, since nothing else has a place to
 * pick up from. The switch is the slot's own setting and saves with it.
 *
 * The place is the STATION's, not the form's: it moves every time a record from the playlist airs, so
 * it is read from the station for the slot as saved, and only while the slot as saved resumes and the
 * form still names the playlist it was saved with. A slot not yet saved, or one whose playlist the form
 * has changed, has no place to show, and the line says to save it rather than showing one that the save
 * would throw away. "Start from the top" acts at once rather than on save, because it is about what the
 * station has aired rather than about the slot, and saving the form does not undo it.
 */
export function ResumePlaylistField({ input, slotId, saved }: Props) {
    const { t } = useTranslation('schedule');
    const on = input.checked === true;

    return (
        <Stack gap={6}>
            <Switch label={t('slot.resume.label')} description={t('slot.resume.description')} {...input} />
            {on ? slotId !== undefined && saved ? <Place slotId={slotId} /> : <Note>{t('slot.resume.unsaved')}</Note> : undefined}
        </Stack>
    );
}

/** Where the saved slot will pick its playlist up, and the one control that sends it back to the top. */
function Place({ slotId }: { slotId: string }) {
    const { t } = useTranslation('schedule');
    const position = useSlotPlaylistPosition(slotId, true);
    const restart = useRestartSlotPlaylist();

    if (position.isPending) return undefined;
    if (position.isError) return <Note>{t('slot.resume.readFailed')}</Note>;

    const next = position.data.title === undefined ? undefined : { title: position.data.title, artist: position.data.artist ?? '' };

    return (
        <Stack gap={4}>
            <Group gap="xs" wrap="wrap">
                <Note>{next === undefined ? t('slot.resume.fromTop') : t('slot.resume.next', next)}</Note>
                {next === undefined ? undefined : (
                    <Button size="compact-xs" variant="default" loading={restart.isPending} onClick={() => restart.mutate(slotId)}>
                        {t('slot.resume.restart')}
                    </Button>
                )}
            </Group>
            {restart.isError ? (
                <Text size="xs" c="red">
                    {t('slot.resume.restartFailed')}
                </Text>
            ) : undefined}
        </Stack>
    );
}

function Note({ children }: { children: string }) {
    return (
        <Text size="xs" c="dimmed">
            {children}
        </Text>
    );
}

interface Props {
    /** The switch, as the form's checkbox props. */
    input: GetInputPropsReturnType;
    /** The slot being edited, or undefined for a new one, which has aired nothing. */
    slotId?: string;
    /** Whether the slot as saved resumes the playlist the form names now, so the station's place applies to it. */
    saved: boolean;
}
