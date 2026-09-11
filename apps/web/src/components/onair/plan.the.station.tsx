import { useState } from 'react';
import { Button, Divider, Group, Modal, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { StationMode, StationOnEnd, StationOrder } from '@deadair/sdk';

import { usePutStationOnAir, useReplanOrder } from '../../api/director.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { BriefField, CallinsField, EraFields, EraNote, HostField, ShapeFields, ShapeNote } from '../programme/programme.fields';
import { ErrorAlert } from '../shared/error.alert';

/**
 * Changing what the station is playing, and saying whether this is still the same show.
 *
 * ## Why one control rather than two
 *
 * This replaces Replan and the desk's briefing card, which were never two forms. `ReplanStationInput`
 * is `{ count?, brief? }` — a strict subset of `PutOnAirInput` — so the two differed on exactly one
 * axis, and that axis was encoded as *which of two differently-shaped controls you clicked*. The
 * evidence it was wrong is that both components had to spend a paragraph defining themselves against
 * the other, and the briefing card was the only always-open form in a row of popovers.
 *
 * The axis is a question instead: **does this stay the same show?** Keeping it holds the
 * `broadcastId`, the host, the slot stamp and the record that is playing, and regenerates the tail.
 * Starting a new one resets all of that and stops what is playing.
 *
 * ## The scope changes which fields EXIST, not which are greyed out
 *
 * A replan can only carry a brief: `replanOrder` posts a `rebrief` and sends a job, and the host,
 * the period and the source are read off the running order it is already on. So under "keep this
 * show" the rest of the form is absent, with one sentence saying where those live, rather than
 * present and disabled. A wall of greyed inputs is a worse answer than an absence plus a reason —
 * it invites the operator to try, and says nothing about why they cannot.
 *
 * ## The default is the safe half, and the two are not the same size of decision
 *
 * "Keep this show" cuts nobody off. "Start a new show" is heard by everybody listening within a
 * record. The old briefing card carried an orange line saying so and it is kept, because the
 * segmented control makes the two look like peers and one of them is not.
 *
 * ## Seeding differs by scope on purpose
 *
 * Keeping seeds the brief off the running order, so clearing it is an obvious gesture and the
 * operator can see what is currently steering the refills. Starting opens empty, because it mints a
 * new broadcast rather than editing this one — both behaviours carried over from the components this
 * replaces, where they were correct for the same reasons.
 */
export interface PlanTheStationProps {
    /** The broadcast this would change, for seeding and for whether there is one to keep. */
    order?: StationOrder;
    disabled?: boolean;
}

type Scope = 'keep' | 'new';

export function PlanTheStation({ order, disabled = false }: PlanTheStationProps) {
    const [opened, setOpened] = useState(false);
    // Safe side first. It is also the commoner want: most of the time an operator does not like what
    // is coming, not what is on.
    const [scope, setScope] = useState<Scope>('keep');

    const replan = useReplanOrder();
    const onAir = usePutStationOnAir();

    const brief = order?.brief ?? '';
    const form = useForm<FormValues>({ initialValues: valuesOf(order) });

    // Nothing is on, so there is no show to keep and the choice is not a choice.
    const nothingOn = order === undefined || order.items.length === 0;
    const keeping = scope === 'keep' && !nothingOn;

    const failure = replan.isError
        ? apiErrorMessage(replan.error, 'The running order could not be replanned.')
        : onAir.isError
          ? apiErrorMessage(onAir.error, 'The station could not be put on air.')
          : undefined;

    // Seeded HERE rather than through `initialValues`, which `useForm` reads once per mount. This
    // component is mounted with the desk and the running order arrives on a poll after it, so a
    // form seeded at mount would open showing an empty brief on a broadcast that has one. Opening
    // is also the right moment for the other reason: a draft abandoned last time should not still
    // be sitting in the box.
    const open = () => {
        form.setValues(valuesOf(order));
        setScope(nothingOn ? 'new' : 'keep');
        setOpened(true);
    };

    const close = () => {
        setOpened(false);
        replan.reset();
        onAir.reset();
    };

    const send = () => {
        const asked = form.values.brief.trim();

        if (keeping) {
            // Sent only when it actually differs. Absent keeps whatever the broadcast carries and an
            // empty string CLEARS it, so passing the box back unchanged would turn "I did not touch
            // this" into a rewrite of the same words.
            replan.mutate(asked === brief ? {} : { brief: asked });
            close();
            return;
        }

        if (asked.length === 0) return;

        onAir.mutate(
            {
                brief: asked,
                // The brief doubles as the label. An operator who asked for heavy metal hits should
                // see that on the page rather than "The station".
                name: asked,
                ...(form.values.personaId ? { personaId: form.values.personaId } : {}),
                ...(typeof form.values.eraFrom === 'number' ? { eraFrom: form.values.eraFrom } : {}),
                ...(typeof form.values.eraTo === 'number' ? { eraTo: form.values.eraTo } : {}),
                // Sent only when it is ON. Absent leaves the station's own setting standing, which is
                // what an operator who did not think about the phone means.
                ...(form.values.callins ? { callins: true } : {}),
                mode: form.values.mode,
                onEnd: form.values.onEnd,
            },
            { onSuccess: close },
        );
    };

    const busy = replan.isPending || onAir.isPending;

    return (
        <>
            <Tooltip label="Change what the station plays, either from here on or as a new show." multiline maw={320}>
                <Button variant="light" size="compact-md" disabled={disabled} onClick={open}>
                    Plan
                </Button>
            </Tooltip>

            <Modal opened={opened} onClose={close} title="Plan" size="lg">
                <Stack gap="md">
                    {failure ? <ErrorAlert>{failure}</ErrorAlert> : undefined}

                    {nothingOn ? undefined : (
                        <SegmentedControl
                            fullWidth
                            value={scope}
                            onChange={value => setScope(value as Scope)}
                            data={[
                                { value: 'keep', label: 'Keep this show' },
                                { value: 'new', label: 'Start a new show' },
                            ]}
                        />
                    )}

                    {keeping ? (
                        <Text size="sm">
                            Everything still to come is dropped and the station programmes that stretch again. What is playing, and what the player is
                            already holding, keeps going.
                        </Text>
                    ) : (
                        <Text size="sm">
                            The station programmes itself against this, from your own library first and from your providers when the library cannot
                            fill it. A record it does not own yet is fetched and kept. What you like and dislike is taken into account either way.
                        </Text>
                    )}

                    {!keeping && !nothingOn ? (
                        <Text size="sm" c="orange.4">
                            This starts a new broadcast: everything still to come is dropped, and what is playing stops.
                        </Text>
                    ) : undefined}

                    <BriefField
                        description={
                            keeping
                                ? 'This steers every refill for the rest of the broadcast, not just these records. Empty it and the station goes back to its ordinary rotation.'
                                : 'In your own words, for the model that chooses records. It keeps steering every refill until the station is put on air again.'
                        }
                        {...form.getInputProps('brief')}
                    />

                    {keeping ? (
                        // Absent rather than disabled. A replan carries a brief and nothing else:
                        // the host, the period and the shape are bound to the broadcast, and the
                        // command that could change them is the one that ends it.
                        <Text size="xs" c="dimmed">
                            The host, the period and the shape belong to this show and keep running with it. Changing any of them starts a new one.
                        </Text>
                    ) : (
                        <>
                            <HostField markOnAir {...form.getInputProps('personaId')} />

                            <EraFields from={form.getInputProps('eraFrom')} to={form.getInputProps('eraTo')} />

                            <EraNote />

                            <ShapeFields mode={form.getInputProps('mode')} onEnd={form.getInputProps('onEnd')} />

                            <ShapeNote what="broadcast" />

                            <CallinsField {...form.getInputProps('callins', { type: 'checkbox' })} />
                        </>
                    )}

                    <Text size="xs" c="dimmed">
                        {keeping
                            ? 'The records are chosen before the old ones are dropped, so nothing goes quiet. They can take a minute to appear.'
                            : 'Choosing records against your words needs a model configured to programme with. Without one the station plays its own rotation, which is the designed answer rather than a failure.'}
                    </Text>

                    <Divider />

                    <Group justify="flex-end" gap="xs">
                        <Button variant="default" onClick={close}>
                            Cancel
                        </Button>
                        <Button loading={busy} disabled={!keeping && form.values.brief.trim().length === 0} onClick={send}>
                            {keeping ? 'Replan' : 'Go on air'}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
}

interface FormValues {
    brief: string;
    personaId: string;
    /** Empty string is Mantine's "nothing typed" for a NumberInput, and it means no bound. */
    eraFrom: number | string;
    eraTo: number | string;
    callins: boolean;
    mode: StationMode;
    onEnd: StationOnEnd;
}

/**
 * What the form opens on.
 *
 * Only the brief is seeded, and only from the running order. Everything else starts at the station's
 * ordinary defaults rather than at what this broadcast happens to be doing, because every other
 * field only exists on the side that mints a NEW broadcast — showing the current show's host there
 * would read as editing it.
 */
function valuesOf(order?: StationOrder): FormValues {
    return {
        brief: order?.brief ?? '',
        personaId: '',
        eraFrom: '',
        eraTo: '',
        callins: false,
        mode: 'rotation',
        onEnd: 'extend',
    };
}
