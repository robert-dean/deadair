import { Button, Card, Group, NumberInput, Select, SimpleGrid, Stack, Textarea, TextInput } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import type { ProductionRequest } from '@deadair/sdk';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';

import { usePersonas } from '../../api/personas.queries';
import { presents } from '../personas/persona.kind';
import { ErrorAlert } from '../shared/error.alert';

/**
 * Asking the station for a programme.
 *
 * Eight fields, and only one is required. Everything else falls back to a station default rather than
 * being demanded, because the only thing nobody else can supply is what the thing is called — the
 * length, the writing mode and the presenter all have settings, and a form that insisted on them
 * would be asking an operator to re-decide the same things every time.
 *
 * The brief is the field that actually matters and it is the one nobody thinks to fill in, so it
 * gets the room and the explanation. It is what the outline pass works from; a production with a
 * title and no brief is a model guessing what the title meant.
 */
export interface ProductionFormProps {
    pending: boolean;
    error: unknown;
    onSubmit: (body: ProductionRequest) => void;
    onCancel: () => void;
}

/** The modes, said the way the settings page says them, so an operator meets one vocabulary. */
const MODES = ['quick', 'outlined', 'polished'] as const;

/** The eight boxes as the form holds them, before the empty ones are dropped on the way out. */
interface FormValues {
    title: string;
    brief: string;
    /** One note per line, as typed. Split, trimmed and the blank lines dropped on the way out. */
    notes: string;
    kind: string;
    minutes: number | string;
    mode: string | null;
    personaId: string | null;
    /** The picker's own value: a local wall-clock time as `YYYY-MM-DD HH:mm:ss`, or null for "when it is ready". */
    airAt: string | null;
}

/** The notes box as the request carries it: one note per line, trimmed, the blank lines dropped. */
export function notesOf(typed: string): string[] {
    return typed
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
}

/**
 * When the picker says to air it, as the instant the request carries.
 *
 * The picker answers a wall-clock time in the browser's zone with no offset on it, which is what the
 * person meant by "eleven tonight", so it is read as local time rather than as UTC. Empty, or
 * anything that is not a time, is no time at all: the production airs when it is ready.
 */
export function scheduledForOf(airAt: string | null): DateTime | undefined {
    if (airAt === null || airAt.trim().length === 0) return undefined;
    const at = DateTime.fromSQL(airAt.trim());
    return at.isValid ? at : undefined;
}

export function ProductionForm({ pending, error, onSubmit, onCancel }: ProductionFormProps) {
    const { t } = useTranslation(['productions', 'common']);
    const personas = usePersonas();

    const form = useForm<FormValues>({
        // Controlled, like the settings form: Mantine's uncontrolled default does not re-render an
        // input when its ERROR changes, so a refusal would be held and never drawn.
        mode: 'controlled',
        initialValues: { title: '', brief: '', notes: '', kind: 'podcast', minutes: '', mode: null, personaId: null, airAt: null },
        // The one thing that is actually required. It used to be enforced by a disabled button and a
        // silent `return`, which says nothing at all about why: a form that will not submit and will
        // not say why is the same failure as a line an operator mistyped.
        validate: values => (values.title.trim().length === 0 ? { title: t('form.title.required') } : {}),
    });

    const submit = (values: FormValues) => {
        const scheduledFor = scheduledForOf(values.airAt);
        const notes = notesOf(values.notes);
        onSubmit({
            title: values.title.trim(),
            ...(values.kind.trim().length === 0 ? {} : { kind: values.kind.trim() }),
            ...(values.brief.trim().length === 0 ? {} : { brief: values.brief.trim() }),
            ...(notes.length === 0 ? {} : { notes }),
            ...(typeof values.minutes === 'number' && values.minutes > 0 ? { targetMs: values.minutes * 60_000 } : {}),
            ...(values.mode === null ? {} : { writingMode: values.mode as ProductionRequest['writingMode'] }),
            ...(values.personaId === null ? {} : { personaId: values.personaId }),
            ...(scheduledFor === undefined ? {} : { scheduledFor }),
        });
    };

    return (
        <Card>
            {/* A real form element, so Enter in any box asks for the production rather than doing
                nothing — the shortcut every other form in the console already has. */}
            <form onSubmit={form.onSubmit(submit)}>
                <Stack gap="md">
                    {error !== null && error !== undefined && <ErrorAlert title={t('form.error')} error={error} />}

                    <TextInput
                        label={t('form.title.label')}
                        description={t('form.title.description')}
                        placeholder={t('form.title.placeholder')}
                        // `withAsterisk` rather than `required`, which is the settings form's
                        // choice and not a cosmetic one: the native attribute makes the BROWSER
                        // refuse the submit before the form's own validation runs, so the operator
                        // gets a browser bubble where every other refusal in the console is a
                        // message under the input — and on a form with one required box, gets it
                        // instead of being told which box.
                        withAsterisk
                        {...form.getInputProps('title')}
                    />

                    <Textarea
                        label={t('form.brief.label')}
                        description={t('form.brief.description')}
                        placeholder={t('form.brief.placeholder')}
                        autosize
                        minRows={3}
                        {...form.getInputProps('brief')}
                    />

                    <Textarea
                        label={t('form.notes.label')}
                        description={t('form.notes.description')}
                        placeholder={t('form.notes.placeholder')}
                        autosize
                        minRows={3}
                        {...form.getInputProps('notes')}
                    />

                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <TextInput label={t('form.kind.label')} description={t('form.kind.description')} {...form.getInputProps('kind')} />
                        <NumberInput
                            label={t('form.minutes.label')}
                            description={t('form.minutes.description')}
                            min={1}
                            {...form.getInputProps('minutes')}
                        />
                    </SimpleGrid>

                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <Select
                            label={t('form.mode.label')}
                            description={t('form.mode.description')}
                            data={MODES.map(value => ({ value, label: t(`form.mode.option.${value}`) }))}
                            clearable
                            {...form.getInputProps('mode')}
                        />
                        {/* Who PRESENTS it, so hosts only: the callers a production casts are chosen per
                            beat and are not offered here. See `presents`. */}
                        <Select
                            label={t('form.presenter.label')}
                            description={t('form.presenter.description')}
                            data={(personas.data?.personas ?? []).filter(presents).map(persona => ({ value: persona.id, label: persona.label }))}
                            clearable
                            searchable
                            {...form.getInputProps('personaId')}
                        />
                    </SimpleGrid>

                    {/* When it airs. Empty is as soon as it is made, which is what every production
                        did before this; a time holds it, ready, until the first gap at or after it. */}
                    <DateTimePicker
                        label={t('form.airAt.label')}
                        description={t('form.airAt.description')}
                        placeholder={t('form.airAt.placeholder')}
                        valueFormat="ddd D MMM, HH:mm"
                        minDate={new Date()}
                        clearable
                        {...form.getInputProps('airAt')}
                    />

                    <Group justify="flex-end">
                        <Button variant="subtle" onClick={onCancel} disabled={pending}>
                            {t('common:action.cancel')}
                        </Button>
                        <Button type="submit" loading={pending}>
                            {t('form.submit')}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Card>
    );
}
