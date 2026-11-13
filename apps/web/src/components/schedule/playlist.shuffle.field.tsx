import { Switch } from '@mantine/core';
import type { GetInputPropsReturnType } from '@mantine/form';
import { useTranslation } from 'react-i18next';

/**
 * Whether a playlist slot plays its playlist in a shuffled order, drawn each time the block opens.
 *
 * Drawn only under a playlist, the station's own or a provider's, for the same reason as the resume
 * switch beside it. The order is drawn when the block opens, so there is no place to show: the switch
 * is the whole of it, and it saves with the slot.
 */
export function ShufflePlaylistField({ input }: Props) {
    const { t } = useTranslation('schedule');

    return <Switch label={t('slot.shuffle.label')} description={t('slot.shuffle.description')} {...input} />;
}

interface Props {
    /** The switch, as the form's checkbox props. */
    input: GetInputPropsReturnType;
}
