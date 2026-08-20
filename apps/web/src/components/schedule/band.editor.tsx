import type { ReactNode } from 'react';
import { Autocomplete, Button, Divider, Group, Modal, NumberInput, Select, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { ClockBand, ClockBandInput } from '@deadair/sdk';

import { useTopics } from '../../api/topics.queries';
import { ErrorAlert } from '../shared/error.alert';
import { clockToMinutes, minutesToClock } from './schedule.day';

/**
 * Writing one rule of the station's format clock.
 *
 * ## A band is a sentence, so it is written as one
 *
 * The slot editor next door makes the same call for the same reason: "read the news every hour at
 * half past" is a thing an operator says, and stacking it as four labelled fields turns something
 * they can say into something they have to assemble. What changes here is only which words the
 * sentence needs, which is what the `when` picker switches between.
 *
 * ## The kind is a suggestion list and not a menu
 *
 * `segments.kind` is free text on purpose — a station that wants sponsor spots writes `sponsor`, drops
 * the recordings in the segment inbox and needs no migration and no code — so this offers the kinds
 * the station already knows how to produce and takes anything else typed over them. A closed picker
 * here would be the console quietly removing a capability the API has.
 *
 * ## The subject picker is only drawn when the kind HAS subjects
 *
 * A news band can be about a category and a talk break cannot be about anything, so the row appears
 * when the sort of break typed above has subjects named for it and disappears when it does not. An
 * empty picker on every band would be a control that means nothing four times out of five.
 *
 * ## Nothing here reaches what is already planned
 *
 * A band claims boundaries on the director's next pass, so an edit applies from the next one onward
 * and the breaks already planted stay where they are. The running order is the memory, which is what
 * makes editing this safe while the station is on air.
 */
export function BandEditor({ target, onClose, onSubmit, onDelete, saving, deleting, error }: Props) {
    const opened = target !== undefined;
    const band = target?.kind === 'edit' ? target.band : undefined;
    const topics = useTopics();

    const form = useForm<FormValues>({
        // Read once per mount, so the page keys this component on what it is open on: a form that
        // survived a close would open showing the last band's values under the new one's title.
        initialValues: valuesOf(target),
        enhanceGetInputProps: () => ({}),
        validate: {
            kind: value => (value.trim().length === 0 ? 'A band needs a sort of break' : undefined),
            time: (value, values) => (values.when === 'daily' && clockToMinutes(value) === undefined ? 'A time, as 24-hour HH:MM' : undefined),
        },
    });

    // The subjects named for whatever sort of break is typed above, which is why this reads the live
    // field rather than the band: switching the kind switches what it can be about.
    const subjects = (topics.data?.topics ?? []).filter(topic => topic.kind === form.values.kind.trim());

    const submit = form.onSubmit(values => {
        const shape = shapeOf(values);
        if (shape === undefined) return;

        onSubmit({
            kind: values.kind.trim(),
            ...shape,
            // Dropped rather than sent as an empty string: absent means the break covers whatever it
            // finds, which is a different thing from a subject nothing can resolve.
            ...(values.topicId.length === 0 ? {} : { topicId: values.topicId }),
            position: values.position,
            enabled: values.enabled,
        });
    });

    return (
        <Modal opened={opened} onClose={onClose} title={band ? 'Edit band' : 'New band'} size="lg">
            <form onSubmit={submit}>
                <Stack gap="md">
                    {error ? <ErrorAlert title="That band could not be saved" error={error} fallback="Nothing was written." /> : undefined}

                    <Group gap="xs" align="flex-start" wrap="wrap">
                        <Word>Say a</Word>
                        <Autocomplete aria-label="Sort of break" data={KINDS} placeholder="news" w={160} {...form.getInputProps('kind')} />
                        <Select
                            aria-label="How often"
                            data={[
                                { value: 'hourly', label: 'every hour at' },
                                { value: 'daily', label: 'once a day at' },
                                { value: 'interval', label: 'every' },
                            ]}
                            allowDeselect={false}
                            w={150}
                            {...form.getInputProps('when')}
                        />
                        {form.values.when === 'hourly' ? (
                            <Group gap={4} align="flex-start">
                                <Word>:</Word>
                                <NumberInput
                                    aria-label="Minutes past the hour"
                                    min={0}
                                    max={59}
                                    clampBehavior="strict"
                                    w={80}
                                    className="da-num"
                                    {...form.getInputProps('minute')}
                                />
                            </Group>
                        ) : undefined}
                        {form.values.when === 'daily' ? (
                            <TextInput aria-label="Time of day" placeholder="09:00" w={90} className="da-num" {...form.getInputProps('time')} />
                        ) : undefined}
                        {form.values.when === 'interval' ? (
                            <Group gap="xs" align="flex-start">
                                <NumberInput
                                    aria-label="Minutes apart"
                                    min={1}
                                    max={720}
                                    clampBehavior="strict"
                                    w={90}
                                    className="da-num"
                                    {...form.getInputProps('everyMinutes')}
                                />
                                <Word>minutes</Word>
                            </Group>
                        ) : undefined}
                    </Group>

                    {subjects.length > 0 ? (
                        <Select
                            label="About"
                            description={`Only what belongs to this subject. Leave it empty and the break covers whatever it finds.`}
                            data={subjects.map(topic => ({ value: topic.id, label: topic.label }))}
                            clearable
                            {...form.getInputProps('topicId')}
                        />
                    ) : undefined}

                    <Text size="xs" c="dimmed">
                        Times are on the station&apos;s own clock. A band takes the first boundary at or after its time, so a bulletin at half past is
                        read when the record playing then finishes — never before it. The sort of break is free text: write anything you have
                        recordings of and the station will play them.
                    </Text>

                    <Switch
                        label="In force"
                        description="Switched off keeps the rule without the station acting on it."
                        checked={form.values.enabled}
                        onChange={event => form.setFieldValue('enabled', event.currentTarget.checked)}
                    />

                    <Text size="xs" c="dimmed">
                        Saving changes nothing already planned. The band claims its next boundary on the station&apos;s next pass.
                    </Text>

                    <Divider />

                    <Group justify="space-between">
                        {band ? (
                            <Button variant="subtle" color="red" loading={deleting} onClick={() => onDelete(band.id)}>
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
 * The sorts of break a station usually schedules.
 *
 * Suggestions rather than the set: `welcome` is deliberately absent because a greeting is asked for
 * when somebody tunes in rather than at a time, and anything an operator has recordings of belongs
 * here whether or not this list has heard of it.
 */
const KINDS = ['news', 'talkbreak', 'ident', 'sponsor', 'podcast'];

/** One word of the sentence, sitting on the same baseline as the fields around it. */
function Word({ children }: { children: ReactNode }) {
    return (
        <Text size="sm" c="dimmed" style={{ lineHeight: '36px' }}>
            {children}
        </Text>
    );
}

/**
 * What the editor is open on: absent is closed, a band is that band, a new one carries where in the
 * order it will go. The slot editor's union, for its reasons.
 */
export type BandTarget = { kind: 'edit'; band: ClockBand } | { kind: 'new'; position: number };

interface Props {
    target?: BandTarget;
    onClose: () => void;
    onSubmit: (draft: ClockBandInput) => void;
    onDelete: (id: string) => void;
    saving: boolean;
    deleting: boolean;
    error?: unknown;
}

interface FormValues {
    kind: string;
    /** The subject's id, or empty for a band that covers whatever it finds. */
    topicId: string;
    /** Which sentence this is. The API's two shapes, with the common `clock` case split in two. */
    when: 'hourly' | 'daily' | 'interval';
    minute: number;
    time: string;
    everyMinutes: number;
    position: number;
    enabled: boolean;
}

/** The half of the band its shape actually carries. The other half is dropped rather than sent. */
function shapeOf(values: FormValues): Pick<ClockBandInput, 'at' | 'hour' | 'minute' | 'everyMs'> | undefined {
    if (values.when === 'interval') return { at: 'interval', everyMs: values.everyMinutes * 60_000 };
    if (values.when === 'hourly') return { at: 'clock', minute: values.minute };

    const minutes = clockToMinutes(values.time);
    if (minutes === undefined) return undefined;

    return { at: 'clock', hour: Math.floor(minutes / 60), minute: minutes % 60 };
}

function valuesOf(target?: BandTarget): FormValues {
    const band = target?.kind === 'edit' ? target.band : undefined;
    const when = band === undefined ? 'hourly' : band.at === 'interval' ? 'interval' : band.hour === undefined ? 'hourly' : 'daily';

    return {
        kind: band?.kind ?? '',
        topicId: band?.topicId ?? '',
        when,
        // Half past for a new hourly band, which is where a bulletin usually goes and is well clear
        // of the top of the hour a station tends to name itself at.
        minute: band?.minute ?? 30,
        time: minutesToClock((band?.hour ?? 9) * 60 + (band?.minute ?? 0)),
        everyMinutes: Math.round((band?.everyMs ?? 90 * 60_000) / 60_000),
        position: band?.position ?? (target?.kind === 'new' ? target.position : 0),
        enabled: band?.enabled ?? true,
    };
}
