import { useState } from 'react';
import { Anchor, Group, Stack, Title } from '@mantine/core';
import { IconChevronLeft } from '@tabler/icons-react';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ScheduleSlotInput } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { useApplySlot, useCreateSlot, useCurrentSlot, useDeleteSlot, useSchedule, useUpdateSlot } from '../../api/schedule.queries';
import { UnsavedGuard } from '../settings/unsaved.guard';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { notifyDone, notifyQueued } from '../shared/notify';
import { PageSkeleton } from '../shared/page.skeleton';
import type { ProgrammeTab } from './schedule.page';
import { describeApplied } from './slot.applied';
import { SlotEditorForm, slotEditorTitle, type EditorTarget } from './slot.editor';

/** Which show the page is open on: one already in the schedule by its id, or a new one and where it was asked for. */
export type ShowEditorOpen = { slotId: string } | { fresh: Extract<EditorTarget, { kind: 'new' }> };

export interface ShowEditorPageProps {
    open: ShowEditorOpen;
    /** The Programme tab the operator came from, which is where Back, a save and a delete return to. */
    from: ProgrammeTab;
}

/**
 * One show of the station's schedule, on a page of its own.
 *
 * ## Why a page rather than the dialog it was
 *
 * The editor grew to some thirty fields, and a dialog that tall is a page that cannot be linked to,
 * reloaded or reached with the back button. As a route it can be all three, and the four places that
 * open a show (the week grid, Today's strip, Specials and the switched-off list) are links to it.
 *
 * ## The guard
 *
 * The dialog shielded unsaved edits by being a dialog: the shell's d, p, l and v keys do nothing while
 * one is open. A page has no such shield, so `UnsavedGuard` asks before any navigation, those keys
 * included, would throw an edit away. A save or a delete leaves with `ignoreBlocker`, since the work
 * is not being thrown away then: it has been written.
 *
 * ## Saving is the dialog's saving, moved
 *
 * Save writes the slot, and Save and apply now writes it and then asks the station to change the
 * show on air in place, in that order and only once the write has landed, for the reason
 * `SlotEditor` always gave: the station applies the slot as it is STORED.
 */
export function ShowEditorPage({ open, from }: ShowEditorPageProps) {
    const { t } = useTranslation(['schedule', 'common']);
    const navigate = useNavigate();
    const schedule = useSchedule();
    const current = useCurrentSlot();
    const create = useCreateSlot();
    const update = useUpdateSlot();
    const remove = useDeleteSlot();
    const applyTo = useApplySlot();
    const [dirty, setDirty] = useState(false);
    // Which of the two buttons the save in flight came from, so only that one spins.
    const [applying, setApplying] = useState(false);

    const leave = () => void navigate({ to: '/schedule', search: { tab: from }, ignoreBlocker: true });
    const back = (
        <Anchor size="sm" renderRoot={(props: object) => <Link to="/schedule" search={{ tab: from }} {...props} />}>
            <Group gap={4} wrap="nowrap">
                <IconChevronLeft size={14} aria-hidden />
                {t('showPage.back')}
            </Group>
        </Anchor>
    );

    if (schedule.error) {
        return (
            <Stack gap="lg">
                {back}
                <ErrorAlert title={t('showPage.loadFailedTitle')} error={schedule.error} fallback={t('showPage.loadFailedFallback')} />
            </Stack>
        );
    }
    if (schedule.data === undefined) return <PageSkeleton variant="card" />;

    const slot = 'slotId' in open ? schedule.data.slots.find(candidate => candidate.id === open.slotId) : undefined;
    const target: EditorTarget | undefined = 'fresh' in open ? open.fresh : slot === undefined ? undefined : { kind: 'edit', slot };

    if (target === undefined) {
        return (
            <Stack gap="lg">
                {back}
                <Title order={1}>{t('showPage.missingTitle')}</Title>
                <EmptyState>{t('showPage.missing')}</EmptyState>
            </Stack>
        );
    }

    const submit = (draft: ScheduleSlotInput) => {
        const done = { onSuccess: leave };
        if (target.kind === 'edit') update.mutate({ id: target.slot.id, body: draft }, done);
        else create.mutate(draft, done);
    };

    const saveAndApply = (draft: ScheduleSlotInput) => {
        if (target.kind !== 'edit') return;
        const id = target.slot.id;
        setApplying(true);
        update.mutate(
            { id, body: draft },
            {
                onError: () => setApplying(false),
                onSuccess: () =>
                    applyTo.mutate(id, {
                        onSuccess: answer => {
                            const { message, queued } = describeApplied(answer);
                            (queued ? notifyQueued : notifyDone)(message);
                            leave();
                        },
                        onError: () => setApplying(false),
                    }),
            },
        );
    };

    return (
        <Stack gap="lg">
            <Stack gap="xxs">
                {back}
                <Title order={1}>{target.kind === 'edit' && target.slot.label ? target.slot.label : slotEditorTitle(t, target)}</Title>
            </Stack>

            {remove.error ? (
                <ErrorAlert title={t('page.deleteFailedTitle')} error={remove.error} fallback={t('page.deleteFailedFallback')} />
            ) : undefined}

            <SlotEditorForm
                target={target}
                airing={target.kind === 'edit' && target.slot.id === current.data?.airingSlotId}
                onCancel={() => void navigate({ to: '/schedule', search: { tab: from } })}
                onDirtyChange={setDirty}
                onSubmit={submit}
                onApply={saveAndApply}
                onDelete={id => remove.mutate(id, { onSuccess: leave })}
                saving={create.isPending || (update.isPending && !applying)}
                applying={applying && (update.isPending || applyTo.isPending)}
                deleting={remove.isPending}
                error={create.error ?? update.error}
                applyError={applyTo.error}
            />

            <UnsavedGuard dirty={dirty} />
        </Stack>
    );
}
