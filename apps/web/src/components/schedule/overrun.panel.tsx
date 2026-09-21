import { Button, Card, Group, NumberInput, Stack, Switch, Text } from '@mantine/core';
import { useForm } from '@mantine/form';

import { useSettings, useUpdateSettings } from '../../api/settings.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';

/**
 * The settings this writes, which `ScheduleService.overrunCap()` reads on the other side.
 *
 * Named here rather than taken from the descriptors, on `SustainingPanel`'s terms: the schedule group
 * is drawn by this page and by nothing on the settings page, and they stay declared in
 * `settings.registry.ts` because `PUT /settings` refuses a key nobody declared.
 */
const KEYS = {
    on: 'schedule.capOverrun',
    minutes: 'schedule.overrunMinutes',
} as const;

/** The registry's own default and range, restated because the page draws its own controls. */
const DEFAULT_MINUTES = 5;
const MAX_MINUTES = 60;

interface FormValues {
    on: boolean;
    /** Empty string is Mantine's "nothing typed" for a `NumberInput`, and it saves as the default. */
    minutes: number | string;
}

/**
 * Whether a block starts when the timetable says, or when the record before it ends.
 *
 * The timetable draws a block starting on the hour, and until this existed the station could not
 * promise that: the record playing at the boundary always finished, however long it was. It still
 * does by default, and this is where an operator who wants the grid to mean what it shows says so.
 *
 * Under the grid rather than on a tab of its own, because it is a fact about every boundary drawn
 * above it and a single sentence long.
 */
export function OverrunPanel() {
    const settings = useSettings();
    const save = useUpdateSettings();

    const stored = storedValues(settings.data?.values ?? {});

    const submit = (next: FormValues) => {
        save.mutate({
            [KEYS.on]: next.on,
            // Only a real number is stored. Emptied, the row goes and the default stands, which is
            // the same null-deletes-the-row gesture the sustaining form uses.
            [KEYS.minutes]: typeof next.minutes === 'number' ? next.minutes : null,
        });
    };

    return (
        <Card padding="lg">
            <Stack gap="sm">
                <Eyebrow>At a boundary</Eyebrow>
                {settings.error ? (
                    <ErrorAlert title="The boundary setting could not be read" error={settings.error} fallback="How a block starts is unavailable." />
                ) : settings.data === undefined ? undefined : (
                    // Keyed on what the server last said, for `SustainingForm`'s reason: `useForm`
                    // reads its initial values once per mount.
                    <OverrunForm
                        key={JSON.stringify(stored)}
                        initial={stored}
                        onSubmit={submit}
                        saving={save.isPending}
                        succeeded={save.isSuccess}
                        failure={save.isError ? apiErrorMessage(save.error, 'The boundary setting could not be saved.') : undefined}
                    />
                )}
            </Stack>
        </Card>
    );
}

interface OverrunFormProps {
    initial: FormValues;
    onSubmit: (values: FormValues) => void;
    saving: boolean;
    succeeded: boolean;
    failure?: string;
}

function OverrunForm({ initial, onSubmit, saving, succeeded, failure }: OverrunFormProps) {
    const form = useForm<FormValues>({ initialValues: initial });

    return (
        <form onSubmit={form.onSubmit(onSubmit)}>
            <Stack gap="sm">
                {failure ? <ErrorAlert title="That could not be saved">{failure}</ErrorAlert> : undefined}

                <Switch
                    label="Start shows on time"
                    description="Off, the record playing when a block starts always finishes, however long it is. On, a record from the last programme that is still going this long into the new one is cut, the way Skip cuts it."
                    {...form.getInputProps('on', { type: 'checkbox' })}
                />

                <NumberInput
                    label="Minutes a record may run into the next show"
                    description="Most records end well inside five minutes, so only the long ones are cut. Zero cuts whatever is playing the moment the block starts."
                    min={0}
                    max={MAX_MINUTES}
                    allowDecimal={false}
                    maw={320}
                    disabled={!form.values.on}
                    {...form.getInputProps('minutes')}
                />

                <Text size="xs" c="dimmed">
                    Only the schedule’s own changeovers are affected. A programme you put on by hand always lets the record finish.
                </Text>

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

/** The settings as the form's own values, with the tolerance the console gives a hand-edited row. */
function storedValues(values: Record<string, unknown>): FormValues {
    const on = values[KEYS.on];
    const minutes = values[KEYS.minutes];
    const parsed = typeof minutes === 'number' ? minutes : typeof minutes === 'string' && minutes.trim() !== '' ? Number(minutes) : Number.NaN;

    return {
        on: on === true || on === 'true',
        minutes: Number.isFinite(parsed) ? parsed : DEFAULT_MINUTES,
    };
}
