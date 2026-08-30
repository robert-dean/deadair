import { Button, Card, Group, NumberInput, Select, SimpleGrid, Stack, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { ProductionRequest } from '@deadair/sdk';

import { usePersonas } from '../../api/personas.queries';
import { ErrorAlert } from '../shared/error.alert';

/**
 * Asking the station for a programme.
 *
 * Six fields, and only one is required. Everything else falls back to a station default rather than
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
const MODES = [
    { value: 'quick', label: 'Quick — one draft per beat' },
    { value: 'outlined', label: 'Outlined — plan it, then write it' },
    { value: 'polished', label: 'Polished — plan, write, then check and fix' },
];

/** The six boxes as the form holds them, before the empty ones are dropped on the way out. */
interface FormValues {
    title: string;
    brief: string;
    kind: string;
    minutes: number | string;
    mode: string | null;
    personaId: string | null;
}

export function ProductionForm({ pending, error, onSubmit, onCancel }: ProductionFormProps) {
    const personas = usePersonas();

    const form = useForm<FormValues>({
        // Controlled, like the settings form: Mantine's uncontrolled default does not re-render an
        // input when its ERROR changes, so a refusal would be held and never drawn.
        mode: 'controlled',
        initialValues: { title: '', brief: '', kind: 'podcast', minutes: '', mode: null, personaId: null },
        // The one thing that is actually required. It used to be enforced by a disabled button and a
        // silent `return`, which says nothing at all about why: a form that will not submit and will
        // not say why is the same failure as a line an operator mistyped.
        validate: values => (values.title.trim().length === 0 ? { title: 'Give it a name' } : {}),
    });

    const submit = (values: FormValues) => {
        onSubmit({
            title: values.title.trim(),
            ...(values.kind.trim().length === 0 ? {} : { kind: values.kind.trim() }),
            ...(values.brief.trim().length === 0 ? {} : { brief: values.brief.trim() }),
            ...(typeof values.minutes === 'number' && values.minutes > 0 ? { targetMs: values.minutes * 60_000 } : {}),
            ...(values.mode === null ? {} : { writingMode: values.mode as ProductionRequest['writingMode'] }),
            ...(values.personaId === null ? {} : { personaId: values.personaId }),
        });
    };

    return (
        <Card>
            {/* A real form element, so Enter in any box asks for the production rather than doing
                nothing — the shortcut every other form in the console already has. */}
            <form onSubmit={form.onSubmit(submit)}>
                <Stack gap="md">
                    {error !== null && error !== undefined && <ErrorAlert title="Could not ask for that production" error={error} />}

                    <TextInput
                        label="Called"
                        description="What this one is, for the console and for its beats' own labels."
                        placeholder="The machine nobody wanted"
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
                        label="What it should be about"
                        description="In your own words. This is what the planning pass actually works from, and it matters far more than the title does."
                        placeholder="The history of the TR-808: why it flopped, who rescued it, and what it did to pop music."
                        autosize
                        minRows={3}
                        {...form.getInputProps('brief')}
                    />

                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <TextInput label="Kind" description="Free text, and what a clock band names." {...form.getInputProps('kind')} />
                        <NumberInput
                            label="Minutes"
                            description="Leave empty for the station's default. This decides how many beats it has."
                            min={1}
                            {...form.getInputProps('minutes')}
                        />
                    </SimpleGrid>

                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <Select
                            label="How much to write it"
                            description="Leave empty for the station's default."
                            data={MODES}
                            clearable
                            {...form.getInputProps('mode')}
                        />
                        <Select
                            label="Presenter"
                            description="Leave empty and whoever is on air when a pass runs presents it."
                            data={(personas.data?.personas ?? []).map(persona => ({ value: persona.id, label: persona.label }))}
                            clearable
                            searchable
                            {...form.getInputProps('personaId')}
                        />
                    </SimpleGrid>

                    <Group justify="flex-end">
                        <Button variant="subtle" onClick={onCancel} disabled={pending}>
                            Cancel
                        </Button>
                        <Button type="submit" loading={pending}>
                            Ask for it
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Card>
    );
}
