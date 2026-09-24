import { useState } from 'react';
import { Button, Card, Collapse, Group, NumberInput, Stack, Text } from '@mantine/core';
import { useForm } from '@mantine/form';

import { useSettings, useUpdateSettings } from '../../api/settings.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';

/**
 * The setting this writes, which `resolveThreadGapMs` reads for every story in parts and running
 * joke. Named here rather than taken from the descriptors, on `PresenterNamePanel`'s terms: the
 * `personas` group is drawn by this page and by nothing on the settings page, and it stays declared
 * in `settings.registry.ts` because `PUT /settings` refuses a key nobody declared.
 */
const KEY = 'personas.threadGapMinutes';

/**
 * The registry's own default and range, restated because the panel draws its own control.
 *
 * The floor is a correctness bound rather than taste: breaks are written several records ahead, and
 * below it two of them can be handed the same part of one story.
 */
export const DEFAULT_MINUTES = 40;
export const MIN_MINUTES = 10;
export const MAX_MINUTES = 1_440;

/**
 * How long a presenter leaves a story in parts, or a running joke, before coming back to it.
 *
 * ## Why it is here and not under Settings
 *
 * It shipped with the stories themselves, in the `personas` group, and for a while nothing drew it:
 * the settings page leaves that group to this page, and this page drew only the presenter name. So
 * the one control over how often a story comes round could be changed through the API and nowhere
 * else. It sits above the roster because it is about every character on it, and the stories it
 * paces are opened from the cards below.
 *
 * ## Behind a fold, with the summary in view
 *
 * The same shape as `PresenterNamePanel`: the sentence that stays on screen says what the wait is
 * now, which is most of what an operator wants from it.
 */
export function StoryWaitPanel() {
    const settings = useSettings();
    const save = useUpdateSettings();
    const [opened, setOpened] = useState(false);

    const stored = storedMinutes(settings.data?.values ?? {});

    return (
        <Card padding="lg">
            <Stack gap="sm">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={2}>
                        <Eyebrow>Returning to a story</Eyebrow>
                        {/* Nothing is claimed until the settings have answered, for the presenter
                            name's reason: an unanswered read looks like a station that set nothing. */}
                        <Text size="sm" c="dimmed" maw={620}>
                            {settings.data === undefined ? ' ' : summaryOf(stored)}
                        </Text>
                    </Stack>
                    <Button size="xs" variant="light" onClick={() => setOpened(open => !open)}>
                        {opened ? 'Done' : 'Change'}
                    </Button>
                </Group>

                {settings.error ? (
                    <ErrorAlert title="The story wait could not be read" error={settings.error} fallback="The station settings are unavailable." />
                ) : undefined}

                <Collapse expanded={opened}>
                    {/* Keyed on what the server last said, so the form is built from the answer
                        rather than from the empty map the first render has. */}
                    <StoryWaitForm
                        key={stored}
                        initial={stored}
                        // Only a real number is stored. Emptied, the row goes and the default
                        // stands: an explicit null deletes it, as the presenter name's does.
                        onSubmit={minutes => save.mutate({ [KEY]: typeof minutes === 'number' ? minutes : null })}
                        saving={save.isPending}
                        succeeded={save.isSuccess}
                        failure={save.isError ? apiErrorMessage(save.error, 'The story wait could not be saved.') : undefined}
                    />
                </Collapse>
            </Stack>
        </Card>
    );
}

interface StoryWaitFormProps {
    initial: number;
    /** Empty string is Mantine's "nothing typed" for a `NumberInput`. */
    onSubmit: (minutes: number | string) => void;
    saving: boolean;
    succeeded: boolean;
    failure?: string;
}

function StoryWaitForm({ initial, onSubmit, saving, succeeded, failure }: StoryWaitFormProps) {
    const form = useForm<{ minutes: number | string }>({ initialValues: { minutes: initial } });

    return (
        <form onSubmit={form.onSubmit(values => onSubmit(values.minutes))}>
            <Stack gap="md" pt="sm">
                {failure ? <ErrorAlert title="That could not be saved">{failure}</ErrorAlert> : undefined}

                <NumberInput
                    label="Wait before returning to a story (minutes)"
                    description={`How long a presenter leaves a story in parts, or a running joke, before coming back to it. Long enough that a listener hears the character return to something rather than dwell on it. ${MIN_MINUTES} is a floor rather than a suggestion: breaks are written several records ahead, and below it two of them can be handed the same part.`}
                    min={MIN_MINUTES}
                    max={MAX_MINUTES}
                    step={5}
                    allowDecimal={false}
                    maw={360}
                    {...form.getInputProps('minutes')}
                />

                <Group justify="flex-end" gap="md">
                    {succeeded && !form.isDirty() ? (
                        <Text size="sm" c="dimmed">
                            Saved.
                        </Text>
                    ) : undefined}
                    <Button type="submit" loading={saving}>
                        Save
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}

/** The stored wait in minutes, with the tolerance the console gives a hand-edited row. */
function storedMinutes(values: Record<string, unknown>): number {
    const value = values[KEY];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : DEFAULT_MINUTES;
}

/** What the wait is now, as one line. Hours past sixty minutes, because "180 minutes" is a sum. */
export function summaryOf(minutes: number): string {
    return `A presenter leaves ${durationOf(minutes)} before returning to a story in parts or a running joke.`;
}

function durationOf(minutes: number): string {
    if (minutes < 60 || minutes % 60 !== 0) return `${minutes} minutes`;
    const hours = minutes / 60;
    return hours === 1 ? 'an hour' : `${hours} hours`;
}
