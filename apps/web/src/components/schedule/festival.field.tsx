import { Select } from '@mantine/core';
import type { GetInputPropsReturnType } from '@mantine/form';
import type { Festival } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { useFestivals } from '../../api/festivals.queries';

/**
 * Which festival a slot is built around, from the Festivals tab. A festival that is over is offered
 * only when it is the one already chosen, so a picker never draws a saved choice as empty.
 */
export function FestivalField(input: GetInputPropsReturnType & { value: string }) {
    const { t } = useTranslation('schedule');
    const festivals = useFestivals();
    const offered = (festivals.data?.festivals ?? []).filter(festival => festival.state !== 'over' || festival.id === input.value);

    return (
        <Select
            label={t('slot.festival.label')}
            description={t('slot.festival.description')}
            placeholder={t('slot.festival.none')}
            data={offered.map((festival: Festival) => ({ value: festival.id, label: festival.name }))}
            clearable
            nothingFoundMessage={t('slot.festival.nothing')}
            {...input}
            value={input.value === '' ? null : input.value}
            onChange={value => input.onChange(value ?? '')}
        />
    );
}
