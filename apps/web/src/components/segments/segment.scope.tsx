import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Modal, MultiSelect, Stack, Text, Tooltip } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconPencil } from '@tabler/icons-react';
import type { Segment } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { useScopeSegment } from '../../api/segments.queries';
import { personasOptions } from '../../api/personas.queries';
import { scheduleOptions } from '../../api/schedule.queries';
import { ErrorAlert } from '../shared/error.alert';

/** A choice in one of the two pickers. */
interface Choice {
    value: string;
    label: string;
}

/**
 * The shows and presenters an operator can scope a recording to, as choices.
 *
 * Read only when something needs a name: a scoped row, or the picker open. A library with nothing
 * scoped draws "every show" on every row and needs neither list, so it costs neither request.
 */
export function useScopeChoices(enabled: boolean): { slots: Choice[]; personas: Choice[]; loading: boolean } {
    const { t } = useTranslation('segments');
    const schedule = useQuery({ ...scheduleOptions, enabled });
    const personas = useQuery({ ...personasOptions, enabled });

    // A switched-off slot is still a show a recording can belong to: it keeps its recordings for the
    // night it is switched back on, so it is offered too.
    const slots = [...(schedule.data?.slots ?? []), ...(schedule.data?.switchedOff ?? [])].map(slot => ({
        value: slot.id,
        label: slot.label.trim() === '' ? t('scope.untitledSlot') : slot.label,
    }));

    return {
        slots,
        personas: (personas.data?.personas ?? []).map(persona => ({ value: persona.id, label: persona.label })),
        loading: schedule.isLoading || personas.isLoading,
    };
}

/**
 * Which shows a recording is for, and the way to change it.
 *
 * Only on a recording the station was given: what it rendered itself is never drawn from the shelf a
 * show's recordings come from, so a scope there would be a setting that did nothing.
 */
export function SegmentScopeCell({ segment, slots, personas }: { segment: Segment; slots: Choice[]; personas: Choice[] }) {
    const { t } = useTranslation('segments');
    const [editing, setEditing] = useState(false);

    const slotIds = segment.slotIds ?? [];
    const personaIds = segment.personaIds ?? [];
    const scoped = slotIds.length + personaIds.length > 0;
    const nameOf = (choices: Choice[], id: string): string => choices.find(choice => choice.value === id)?.label ?? t('scope.gone');

    return (
        <Group gap={4} wrap="wrap">
            {scoped ? (
                <>
                    {slotIds.map(id => (
                        <Badge key={id} size="xs" variant="light" color="blue">
                            {nameOf(slots, id)}
                        </Badge>
                    ))}
                    {personaIds.map(id => (
                        <Badge key={id} size="xs" variant="light" color="grape">
                            {nameOf(personas, id)}
                        </Badge>
                    ))}
                </>
            ) : (
                <Badge size="xs" variant="outline" color="gray">
                    {t('scope.everyShow')}
                </Badge>
            )}
            <Tooltip label={t('scope.editTooltip')}>
                <ActionIcon variant="subtle" size="xs" aria-label={t('scope.edit', { label: segment.label })} onClick={() => setEditing(true)}>
                    <IconPencil size={12} />
                </ActionIcon>
            </Tooltip>
            {editing ? <ScopeEditor segment={segment} onClose={() => setEditing(false)} /> : undefined}
        </Group>
    );
}

/** The two pickers, in a modal so the table row stays one line tall. */
function ScopeEditor({ segment, onClose }: { segment: Segment; onClose: () => void }) {
    const { t } = useTranslation('segments');
    const choices = useScopeChoices(true);
    const scope = useScopeSegment();
    const [slotIds, setSlotIds] = useState<string[]>(segment.slotIds ?? []);
    const [personaIds, setPersonaIds] = useState<string[]>(segment.personaIds ?? []);

    return (
        <Modal opened onClose={onClose} title={t('scope.title', { label: segment.label })}>
            <Stack gap="sm">
                <Text size="sm" c="dimmed">
                    {t('scope.body')}
                </Text>
                <MultiSelect
                    label={t('scope.shows.label')}
                    description={t('scope.shows.description')}
                    placeholder={slotIds.length === 0 ? t('scope.shows.placeholder') : undefined}
                    data={choices.slots}
                    value={slotIds}
                    onChange={setSlotIds}
                    disabled={choices.loading}
                    clearable
                    searchable
                />
                <MultiSelect
                    label={t('scope.presenters.label')}
                    description={t('scope.presenters.description')}
                    placeholder={personaIds.length === 0 ? t('scope.presenters.placeholder') : undefined}
                    data={choices.personas}
                    value={personaIds}
                    onChange={setPersonaIds}
                    disabled={choices.loading}
                    clearable
                    searchable
                />
                {scope.error ? <ErrorAlert title={t('scope.failed')} error={scope.error} fallback={t('scope.failedFallback')} /> : undefined}
                <Group justify="flex-end" gap="xs">
                    <Button variant="default" onClick={onClose}>
                        {t('scope.cancel')}
                    </Button>
                    <Button
                        loading={scope.isPending}
                        onClick={() => {
                            scope.mutate({ id: segment.id, scope: { slotIds, personaIds } }, { onSuccess: onClose });
                        }}
                    >
                        {t('scope.save')}
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}
