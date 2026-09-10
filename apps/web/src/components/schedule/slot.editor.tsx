import type { ReactNode } from 'react';
import { Button, Chip, Divider, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { ScheduleSlot, ScheduleSlotInput } from '@deadair/sdk';

import {
    BriefField,
    CallinsField,
    ChartOrderField,
    chartSourceValue,
    EraFields,
    EraNote,
    HostField,
    ShapeFields,
    ShapeNote,
    SourceField,
    sourceValue,
    splitSource,
} from '../programme/programme.fields';
import { ErrorAlert } from '../shared/error.alert';
import { DAY_LABELS, minutesToClock, clockToMinutes } from './schedule.day';

/**
 * Writing one slot of the station's day.
 *
 * ## When it is on is a sentence; what it plays is a form
 *
 * The two halves are different kinds of thing. The name, the days and the two times are one
 * statement — "put the breakfast show on weekdays from six until ten" — and stacking them as four
 * labelled fields turns a thing an operator can say into a thing they have to assemble. What it
 * plays underneath genuinely is a list of separate choices, so it stays a list.
 *
 * **And that second half is not this file's.** A slot is `PutOnAirInput` plus a when-half, so every
 * field below the sentence comes from `programme/programme.fields`, which the desk and the
 * sustaining panel draw from too. See that file for why three copies of one form was three places
 * for one wording to drift.
 *
 * ## Both ends, because a slot is a block
 *
 * It ends when it says it ends rather than when the next one starts, so the day need not be covered
 * and the hours nothing claims play the station's sustaining source. An end BEFORE the start runs
 * past midnight, and the same time at both ends is a full day — which needs no special field,
 * because a zero-length block is not a thing anybody wants.
 *
 * Two blocks may not be on at once. The API refuses that with a sentence rather than resolving it by
 * precedence, and the day toggles are why: "the usual show, except Wednesdays" is the usual one
 * on six days plus a second block on Wednesday, which is visible here and on the grid.
 *
 * ## Everything here takes effect at the slot's next boundary
 *
 * Nothing on this form changes what is on air now. That is the invariant the schedule lives inside
 * rather than a limitation of the page, and the page says so where an operator will read it.
 */
export function SlotEditor({ target, onClose, onSubmit, onDelete, saving, deleting, error, airing }: Props) {
    const opened = target !== undefined;
    const slot = target?.kind === 'edit' ? target.slot : undefined;

    const form = useForm<FormValues>({
        // Read ONCE per mount, which is why the page keys this component on what it is open on. A
        // form that survived a close would open showing the last slot's values under the new one's
        // title, and a new slot would open showing the defaults it was first built with.
        initialValues: valuesOf(target),
        enhanceGetInputProps: () => ({}),
        validate: {
            // A slot with no name is what the grid draws as "Untitled", which tells an operator
            // nothing about a block they are looking at to decide something. The API permits it —
            // the column has no minimum — so this is the console refusing to produce one rather than
            // a constraint being enforced twice.
            label: value => (value.trim().length === 0 ? 'A slot needs a name' : undefined),
            startsAt: value => (clockToMinutes(value) === undefined ? 'A time, as 24-hour HH:MM' : undefined),
            endsAt: value => (clockToMinutes(value) === undefined ? 'A time, as 24-hour HH:MM' : undefined),
        },
    });

    const submit = form.onSubmit(values => {
        const startsAtMinutes = clockToMinutes(values.startsAt);
        const endsAtMinutes = clockToMinutes(values.endsAt);
        if (startsAtMinutes === undefined || endsAtMinutes === undefined) return;

        const source = splitSource(values.source);

        onSubmit({
            label: values.label.trim(),
            startsAtMinutes,
            endsAtMinutes,
            days: values.days.map(Number),
            ...(source === undefined
                ? {}
                : source.kind === 'chart'
                  ? { sourceChartId: source.chartId, sourceChartOrder: values.chartOrder }
                  : { sourcePluginId: source.pluginId, sourcePlaylistId: source.playlistId }),
            ...(values.personaId ? { personaId: values.personaId } : {}),
            ...(values.brief.trim() ? { brief: values.brief.trim() } : {}),
            // An empty box is no bound rather than a zero, and the two ends are independent: a lower
            // bound on its own is "this year onwards".
            ...(typeof values.eraFrom === 'number' ? { eraFrom: values.eraFrom } : {}),
            ...(typeof values.eraTo === 'number' ? { eraTo: values.eraTo } : {}),
            // Sent only when it is ON, so an unticked box leaves the station's own setting standing
            // rather than saying this slot takes no calls. The same three-way `putOnAir` has.
            ...(values.callins ? { callins: true } : {}),
            mode: values.mode,
            onEnd: values.onEnd,
        });
    });

    return (
        <Modal opened={opened} onClose={onClose} title={slot ? 'Edit slot' : 'New slot'} size="lg">
            <form onSubmit={submit}>
                <Stack gap="md">
                    {error ? <ErrorAlert title="That slot could not be saved" error={error} fallback="Nothing was written." /> : undefined}

                    {/* The slot the running order belongs to right now: saving it is real, but the
                        station does not hear it until this block comes round again. Told here,
                        beside the form it is about, rather than left for the caption at the
                        bottom of the modal to cover on its own. */}
                    {slot && airing ? (
                        <ErrorAlert tone="notice">This slot is on air. Changes apply the next time it comes round.</ErrorAlert>
                    ) : undefined}

                    {/* The when-half as one sentence. Four fields that only make sense together read
                        as four fields when they are stacked and as one statement when they are not,
                        and a schedule is a thing an operator says out loud: "put the breakfast show
                        on weekdays from six until ten". The what-half stays as fields below, because
                        it genuinely is a list of separate choices. */}
                    <Stack gap="xs">
                        <Group gap="xs" align="flex-start" wrap="wrap">
                            <Word>Put</Word>
                            <TextInput aria-label="Name" placeholder="Breakfast" w={200} {...form.getInputProps('label')} />
                            <Word>from</Word>
                            <TextInput aria-label="Starts at" placeholder="06:00" w={84} className="da-num" {...form.getInputProps('startsAt')} />
                            <Word>until</Word>
                            <TextInput aria-label="Ends at" placeholder="10:00" w={84} className="da-num" {...form.getInputProps('endsAt')} />
                        </Group>

                        {/* Broken here on purpose rather than left to wrap. The days are the one part
                            that cannot shrink, so a single row would fold at whatever width the modal
                            happened to be and the sentence would read as fragments. */}
                        <Group gap="xs" align="center" wrap="wrap">
                            <Word>on</Word>
                            {/* Chips rather than checkboxes: seven boxes in a row is a form control
                                that happens to be about days, and seven toggles is the week. Nothing
                                selected is every day, which the line below says because an empty row
                                cannot. */}
                            <Chip.Group multiple value={form.values.days} onChange={days => form.setFieldValue('days', days)}>
                                <Group gap={4} wrap="wrap">
                                    {DAY_LABELS.map((label, day) => (
                                        <Chip key={label} value={String(day)} size="sm" radius="sm">
                                            {label}
                                        </Chip>
                                    ))}
                                </Group>
                            </Chip.Group>
                        </Group>
                    </Stack>

                    <Text size="xs" c="dimmed">
                        {form.values.days.length === 0 ? 'No day chosen means every day, which is the ordinary case. ' : ''}
                        Times are 24-hour, on the station&apos;s own clock. An end before the start runs the block past midnight; the same time at
                        both ends is a full day. The hours no block covers play whatever the station is set to sustain on.
                    </Text>

                    <SourceField description="Leave it empty for a slot the station fills itself." {...form.getInputProps('source')} />

                    {/* Only under a chart, because it means nothing under anything else. A row that
                        sat there greyed out for every playlist would be a control explaining its own
                        irrelevance on the page an operator uses most. */}
                    {splitSource(form.values.source)?.kind === 'chart' ? <ChartOrderField {...form.getInputProps('chartOrder')} /> : undefined}

                    <HostField {...form.getInputProps('personaId')} />

                    <BriefField {...form.getInputProps('brief')} />

                    <EraFields from={form.getInputProps('eraFrom')} to={form.getInputProps('eraTo')} />

                    <EraNote />

                    <ShapeFields mode={form.getInputProps('mode')} onEnd={form.getInputProps('onEnd')} />

                    <ShapeNote what="block" />

                    <CallinsField {...form.getInputProps('callins', { type: 'checkbox' })} />

                    <Text size="xs" c="dimmed">
                        Saving changes nothing that is on air now. The station moves when this slot next begins.
                    </Text>

                    <Divider />

                    <Group justify="space-between">
                        {/* Delete lives here rather than on a card, because the grid has no room for
                            a per-block control and because deleting a slot is a decision made while
                            looking at what it says. Nothing is on air over it: the station keeps
                            playing what it has until the next slot begins. */}
                        {slot ? (
                            <Button variant="subtle" color="red" loading={deleting} onClick={() => onDelete(slot.id)}>
                                Delete
                            </Button>
                        ) : (
                            <span />
                        )}
                        <Group gap="xs">
                            <Button variant="default" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" loading={saving}>
                                Save
                            </Button>
                        </Group>
                    </Group>
                </Stack>
            </form>
        </Modal>
    );
}

/**
 * One word of the sentence.
 *
 * The line height is the height of an input rather than of the text, which is what keeps the words
 * sitting on the same baseline as the fields between them. Centring the row instead would work until
 * a field showed a validation message underneath and dragged its neighbours down with it.
 */
function Word({ children }: { children: ReactNode }) {
    return (
        <Text size="sm" c="dimmed" style={{ lineHeight: '36px' }}>
            {children}
        </Text>
    );
}

/**
 * What the editor is open on: absent is closed, a slot is that slot, and a new one may arrive
 * knowing where on the grid it was asked for.
 *
 * A union rather than `slot | null | undefined` because the two states read differently at every use
 * — the title, the Delete button and the initial values all branch on it — and because a new slot is
 * no longer nothing: clicking six on a Wednesday means six on a Wednesday, and that has to be
 * carried.
 */
export type EditorTarget = { kind: 'edit'; slot: ScheduleSlot } | { kind: 'new'; startsAtMinutes?: number; days?: number[] };

interface Props {
    target?: EditorTarget;
    onClose: () => void;
    onSubmit: (draft: ScheduleSlotInput) => void;
    onDelete: (id: string) => void;
    saving: boolean;
    deleting: boolean;
    error?: unknown;
    /** Whether `target` is the slot the running order currently belongs to. Undefined for a new slot. */
    airing?: boolean;
}

interface FormValues {
    label: string;
    startsAt: string;
    endsAt: string;
    days: string[];
    /** A playlist pair or a chart id as one tagged option value, since a picker holds one string. */
    source: string;
    /** Which way round a chart is played. Sent only when the source IS one; meaningless otherwise. */
    chartOrder: NonNullable<ScheduleSlot['sourceChartOrder']>;
    personaId: string;
    brief: string;
    /** Empty string is Mantine's "nothing typed" for a NumberInput, and it means no bound. */
    eraFrom: number | string;
    eraTo: number | string;
    /** Ticked sends `true`; unticked sends nothing, which is not the same as `false`. See `CallinsField`. */
    callins: boolean;
    mode: ScheduleSlot['mode'];
    onEnd: ScheduleSlot['onEnd'];
}

function valuesOf(target?: EditorTarget): FormValues {
    const slot = target?.kind === 'edit' ? target.slot : undefined;
    const prefill = target?.kind === 'new' ? target : undefined;

    return {
        label: slot?.label ?? '',
        // A block asked for by clicking the grid knows its hour; one from the button starts at six,
        // which is where a station's day usually does. Three hours long either way, because a block
        // has to have a length and there is no better guess than a plausible one.
        startsAt: minutesToClock(slot?.startsAtMinutes ?? prefill?.startsAtMinutes ?? 6 * 60),
        endsAt: minutesToClock(slot?.endsAtMinutes ?? (prefill?.startsAtMinutes ?? 6 * 60) + 3 * 60),
        days: (slot?.days ?? prefill?.days ?? []).map(String),
        source: slot?.sourceChartId
            ? chartSourceValue(slot.sourceChartId)
            : slot?.sourcePluginId && slot.sourcePlaylistId
              ? sourceValue(slot.sourcePluginId, slot.sourcePlaylistId)
              : '',
        // Only ever sent alongside a chart, so a slot that has never been one still carries the
        // default the API would have applied anyway.
        chartOrder: slot?.sourceChartOrder ?? 'countdown',
        personaId: slot?.personaId ?? '',
        brief: slot?.brief ?? '',
        eraFrom: slot?.eraFrom ?? '',
        eraTo: slot?.eraTo ?? '',
        callins: slot?.callins ?? false,
        mode: slot?.mode ?? 'rotation',
        onEnd: slot?.onEnd ?? 'extend',
    };
}
