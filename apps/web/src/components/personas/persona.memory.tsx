import { useState } from 'react';
import { Badge, Button, Card, Checkbox, Group, Modal, Stack, Text, Tooltip } from '@mantine/core';
import type { PersonaMemoryChange, PersonaTelling } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { usePersonaMemory, usePreviewPersonaRollback, useRollbackPersonaMemory } from '../../api/personas.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { PageSkeleton } from '../shared/page.skeleton';
import { formatMomentFull } from '../shared/feed.moment';

/**
 * What a character has actually told, and the way back.
 *
 * ## The timeline is the control, not a log beside one
 *
 * There is no date picker here, and that is the design rather than a shortcut. A rollback is chosen
 * by pointing at a row — "back to before this" — because the moment that actually matters to an
 * operator is always "just before the thing I did not like", and a picker makes them read a
 * timestamp off one row and type it into another field. It is also the safer shape: the string
 * handed back is the row's own, so nothing is re-rendered or rounded on the way.
 *
 * ## Nothing happens without the preview
 *
 * Picking a row asks the station what that would undo and shows the counts before the button that
 * does it appears. Two of those counts exist because they are the only ways a rollback can cost
 * something an operator did not expect: a proposal they turned down becomes proposable again, and a
 * proposal they had ACCEPTED is still the station's row and still goes.
 *
 * ## Re-learning is off, and it is a separate question
 *
 * Dragging the distil watermark back is right when an operator is testing and wrong when they are
 * undoing a character that drifted: the second wants the conclusions gone, and re-reading the window
 * invites tonight's pass to reach them again. So it is a checkbox that starts clear.
 */
export function PersonaMemoryPanel({ personaId, label }: { personaId: string; label: string }) {
    const memory = usePersonaMemory(personaId);
    const preview = usePreviewPersonaRollback();
    const rollback = useRollbackPersonaMemory();
    const { t } = useTranslation('personas');

    // Which row an operator is asking about, or `reset` for all of it. Held rather than derived,
    // because the dialog has to keep naming what it is about to do after the preview lands.
    const [asking, setAsking] = useState<PersonaTelling | 'reset' | undefined>(undefined);
    const [relearn, setRelearn] = useState(false);

    const tellings = memory.data?.tellings ?? [];

    const ask = (what: PersonaTelling | 'reset') => {
        setAsking(what);
        setRelearn(false);
        preview.reset();
        preview.mutate(what === 'reset' ? { id: personaId } : { id: personaId, to: what.at });
    };

    const confirm = () => {
        if (asking === undefined) return;

        rollback.mutate(
            {
                id: personaId,
                // The row's OWN string, never a re-rendering of it. Postgres keeps a timestamp to the
                // microsecond and JavaScript cannot, so a value that went through a Date here would
                // compare as earlier than its own row and take the row an operator pointed at.
                body: { ...(asking === 'reset' ? {} : { to: asking.at }), ...(relearn ? { relearn: true } : {}) },
            },
            { onSuccess: () => setAsking(undefined) },
        );
    };

    return (
        <Card withBorder mt="sm" padding="sm">
            <Stack gap="sm">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Eyebrow>{t('memory.eyebrow')}</Eyebrow>
                    <Text size="xs" c="dimmed" ta="right">
                        {t('memory.subtitle')}
                    </Text>
                </Group>

                {memory.error ? <ErrorAlert title={t('memory.loadError')} error={memory.error} fallback={t('shared.unchanged')} /> : undefined}

                {rollback.error ? (
                    <ErrorAlert title={t('memory.rollbackError.title')} error={rollback.error} fallback={t('memory.rollbackError.fallback')} />
                ) : undefined}

                {memory.isPending ? <PageSkeleton variant="card" /> : undefined}

                {!memory.isPending && tellings.length === 0 ? (
                    <EmptyState title={t('memory.empty.title')}>{t('memory.empty.body')}</EmptyState>
                ) : undefined}

                {tellings.map(telling => (
                    <TellingRow key={telling.id} telling={telling} busy={rollback.isPending} onRollBack={() => ask(telling)} />
                ))}

                {tellings.length > 0 ? (
                    <Group justify="flex-end">
                        <Tooltip label={t('memory.clearTooltip')} withArrow>
                            <Button variant="subtle" color="red" size="compact-xs" disabled={rollback.isPending} onClick={() => ask('reset')}>
                                {t('memory.clearAll')}
                            </Button>
                        </Tooltip>
                    </Group>
                ) : undefined}
            </Stack>

            <Modal
                opened={asking !== undefined}
                onClose={() => setAsking(undefined)}
                title={asking === 'reset' ? t('memory.confirm.titleReset', { label }) : t('memory.confirm.titleRollback', { label })}
                centered
            >
                <Stack gap="sm">
                    {asking !== undefined && asking !== 'reset' ? (
                        <Text size="sm" c="dimmed">
                            {t('memory.confirm.after', { moment: formatMomentFull(asking.at) })}
                        </Text>
                    ) : undefined}

                    {preview.isPending ? <PageSkeleton variant="card" /> : undefined}

                    {preview.error ? (
                        <ErrorAlert
                            title={t('memory.confirm.previewErrorTitle')}
                            error={preview.error}
                            fallback={t('memory.confirm.previewErrorFallback')}
                        />
                    ) : undefined}

                    {preview.data !== undefined ? <RollbackSummary change={preview.data} /> : undefined}

                    <Checkbox
                        checked={relearn}
                        onChange={event => setRelearn(event.currentTarget.checked)}
                        label={t('memory.confirm.relearn')}
                        description={t('memory.confirm.relearnDescription')}
                    />

                    <Group justify="flex-end" gap="xs">
                        <Button variant="subtle" size="compact-sm" onClick={() => setAsking(undefined)}>
                            {t('memory.confirm.leave')}
                        </Button>
                        <Button
                            color="red"
                            size="compact-sm"
                            loading={rollback.isPending}
                            disabled={preview.isPending || preview.data === undefined}
                            onClick={confirm}
                        >
                            {asking === 'reset' ? t('memory.confirm.clear') : t('memory.confirm.rollBack')}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Card>
    );
}

/** What is about to go, and the two things about it an operator might not expect. */
function RollbackSummary({ change }: { change: PersonaMemoryChange }) {
    const { t } = useTranslation('personas');
    const nothing = change.tellings + change.notes + change.stories + change.details === 0;

    if (nothing)
        return (
            <Text size="sm" c="dimmed">
                {t('memory.summary.nothing')}
            </Text>
        );

    return (
        <Stack gap={6}>
            <Group gap="xs">
                <Count label={t('memory.summary.tellings')} value={change.tellings} />
                <Count label={t('memory.summary.notes')} value={change.notes} />
                <Count label={t('memory.summary.stories')} value={change.stories} />
                <Count label={t('memory.summary.details')} value={change.details} />
            </Group>
            <Text size="xs" c="dimmed">
                {t('memory.summary.stationOnly')}
            </Text>
            {/* The two ways this costs something an operator did not ask for. Stated here rather
                than discovered afterwards. */}
            {change.rejected > 0 ? (
                <Text size="xs" c="orange">
                    {t('memory.summary.rejected', { count: change.rejected })}
                </Text>
            ) : undefined}
            {change.touched > 0 ? (
                <Text size="xs" c="orange">
                    {t('memory.summary.touched', { count: change.touched })}
                </Text>
            ) : undefined}
        </Stack>
    );
}

function Count({ label, value }: { label: string; value: number }) {
    if (value === 0) return undefined;

    return (
        <Badge variant="light" color="gray">
            <span className="da-num">{value}</span> {label}
        </Badge>
    );
}

/**
 * One telling.
 *
 * `told` is drawn rather than assumed, because an offered story the writer passed over is a real and
 * ordinary outcome: the row records that the character was handed it and said nothing. Anything not
 * yet aired is marked too, since that is exactly the state a beat is still owed in.
 */
function TellingRow({ telling, busy, onRollBack }: { telling: PersonaTelling; busy: boolean; onRollBack: () => void }) {
    const { t } = useTranslation('personas');
    return (
        <Card withBorder padding="xs" radius="sm">
            <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
                <Stack gap={4} style={{ minWidth: 0 }}>
                    <Group gap="xs">
                        <Text size="sm" fw={500}>
                            {telling.title}
                        </Text>
                        {telling.told ? undefined : (
                            <Tooltip label={t('memory.telling.passedOverTooltip')} withArrow>
                                <Badge variant="light" color="gray" size="xs">
                                    {t('memory.telling.passedOver')}
                                </Badge>
                            </Tooltip>
                        )}
                        {telling.airedAt === undefined ? (
                            <Tooltip label={t('memory.telling.notAiredTooltip')} withArrow>
                                <Badge variant="light" color="yellow" size="xs">
                                    {t('memory.telling.notAired')}
                                </Badge>
                            </Tooltip>
                        ) : undefined}
                    </Group>
                    {telling.said === undefined ? undefined : (
                        <Text size="xs" c="dimmed" lineClamp={2}>
                            {telling.said}
                        </Text>
                    )}
                    <Text size="xs" c="dimmed" className="da-num">
                        {formatMomentFull(telling.airedAt ?? telling.at)}
                    </Text>
                </Stack>
                <Tooltip label={t('memory.telling.rollBackTooltip')} withArrow>
                    <Button variant="subtle" size="compact-xs" disabled={busy} onClick={onRollBack}>
                        {t('memory.telling.rollBack')}
                    </Button>
                </Tooltip>
            </Group>
        </Card>
    );
}
