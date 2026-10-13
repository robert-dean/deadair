import { ActionIcon, Button, Card, Checkbox, Group, NumberInput, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import type { ProductionRequest, ProductionSource } from '@deadair/sdk';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';

import { usePersonas } from '../../api/personas.queries';
import { presents } from '../personas/persona.kind';
import { ErrorAlert } from '../shared/error.alert';
import { dayjsClock } from '../../i18n/format.locale';

/**
 * Asking the station for a programme.
 *
 * Nine fields, and only one is required. Everything else falls back to a station default rather than
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

/** The nine boxes as the form holds them, before the empty ones are dropped on the way out. */
interface FormValues {
    title: string;
    brief: string;
    /** One note per line, as typed. Split, trimmed and the blank lines dropped on the way out. */
    notes: string;
    /** Sources, as typed: a page's address, pasted text, or both. One with neither is dropped on the way out. */
    sources: TypedSource[];
    /** Given nothing to read, find something on the operator's trusted sites. */
    research: boolean;
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

/** One source row as the form holds it. */
export interface TypedSource {
    title: string;
    url: string;
    text: string;
}

/**
 * The sources as the request carries them: one with neither an address nor text is dropped, since there
 * is nothing in it to read. One with no title is named by its address, which the station replaces with the
 * page's own title once it has read it, or else after its place in the list, since the contract needs a
 * name and an operator pasting an article should not be stopped for want of one.
 */
export function sourcesOf(typed: readonly TypedSource[]): ProductionSource[] {
    return typed
        .filter(source => source.text.trim().length > 0 || source.url.trim().length > 0)
        .map((source, index) => {
            const url = source.url.trim();
            const text = source.text.trim();
            const title = source.title.trim().length > 0 ? source.title.trim() : url.length > 0 ? url : `Source ${index + 1}`;
            return { title, ...(url.length === 0 ? {} : { url }), ...(text.length === 0 ? {} : { text }) };
        });
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
        initialValues: {
            title: '',
            brief: '',
            notes: '',
            sources: [],
            research: false,
            kind: 'podcast',
            minutes: '',
            mode: null,
            personaId: null,
            airAt: null,
        },
        // The one thing that is actually required. It used to be enforced by a disabled button and a
        // silent `return`, which says nothing at all about why: a form that will not submit and will
        // not say why is the same failure as a line an operator mistyped.
        validate: values => (values.title.trim().length === 0 ? { title: t('form.title.required') } : {}),
    });

    const submit = (values: FormValues) => {
        const scheduledFor = scheduledForOf(values.airAt);
        const notes = notesOf(values.notes);
        const sources = sourcesOf(values.sources);
        onSubmit({
            title: values.title.trim(),
            ...(values.kind.trim().length === 0 ? {} : { kind: values.kind.trim() }),
            ...(values.brief.trim().length === 0 ? {} : { brief: values.brief.trim() }),
            ...(notes.length === 0 ? {} : { notes }),
            ...(sources.length === 0 ? {} : { sources }),
            ...(values.research && sources.length === 0 && notes.length === 0 ? { research: true } : {}),
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

                    {/* What to read before writing it. Given sources and no notes, the station reads
                        them first and keeps only what it can find in them. */}
                    <Stack gap="xs">
                        <div>
                            <Text size="sm" fw={500}>
                                {t('form.sources.label')}
                            </Text>
                            <Text size="xs" c="dimmed">
                                {t('form.sources.description')}
                            </Text>
                        </div>
                        {form.values.sources.map((_, index) => (
                            <Card key={index} withBorder padding="sm">
                                <Stack gap="xs">
                                    <Group gap="xs" wrap="nowrap" align="flex-end">
                                        <TextInput
                                            style={{ flex: 1 }}
                                            label={t('form.sources.title')}
                                            placeholder={t('form.sources.titlePlaceholder')}
                                            {...form.getInputProps(`sources.${index}.title`)}
                                        />
                                        <ActionIcon
                                            variant="subtle"
                                            color="gray"
                                            size="lg"
                                            aria-label={t('form.sources.remove')}
                                            onClick={() => form.removeListItem('sources', index)}
                                        >
                                            <IconTrash size={16} />
                                        </ActionIcon>
                                    </Group>
                                    <TextInput
                                        label={t('form.sources.url')}
                                        description={t('form.sources.urlDescription')}
                                        placeholder={t('form.sources.urlPlaceholder')}
                                        {...form.getInputProps(`sources.${index}.url`)}
                                    />
                                    <Textarea
                                        label={t('form.sources.text')}
                                        placeholder={t('form.sources.textPlaceholder')}
                                        autosize
                                        minRows={4}
                                        maxRows={12}
                                        {...form.getInputProps(`sources.${index}.text`)}
                                    />
                                </Stack>
                            </Card>
                        ))}
                        <Group>
                            <Button
                                variant="light"
                                size="compact-sm"
                                leftSection={<IconPlus size={14} />}
                                onClick={() => form.insertListItem('sources', { title: '', url: '', text: '' })}
                            >
                                {t('form.sources.add')}
                            </Button>
                        </Group>
                        {/* Only for a production handed nothing to read, which is when there is
                            anything to find. Its notes, or its sources, are what it was asked about. */}
                        <Checkbox
                            label={t('form.research.label')}
                            description={t('form.research.description')}
                            disabled={form.values.sources.length > 0 || form.values.notes.trim().length > 0}
                            {...form.getInputProps('research', { type: 'checkbox' })}
                        />
                    </Stack>

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
                        valueFormat={`ddd D MMM, ${dayjsClock().time}`}
                        timePickerProps={{ format: dayjsClock().picker }}
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
