import { useState } from 'react';
import { Button, Card, Group, NumberInput, Select, Stack, Textarea, TextInput } from '@mantine/core';
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

export function ProductionForm({ pending, error, onSubmit, onCancel }: ProductionFormProps) {
    const personas = usePersonas();

    const [title, setTitle] = useState('');
    const [brief, setBrief] = useState('');
    const [kind, setKind] = useState('podcast');
    const [minutes, setMinutes] = useState<number | string>('');
    const [mode, setMode] = useState<string | null>(null);
    const [personaId, setPersonaId] = useState<string | null>(null);

    const submit = () => {
        const asked = title.trim();
        if (asked.length === 0) return;

        onSubmit({
            title: asked,
            ...(kind.trim().length === 0 ? {} : { kind: kind.trim() }),
            ...(brief.trim().length === 0 ? {} : { brief: brief.trim() }),
            ...(typeof minutes === 'number' && minutes > 0 ? { targetMs: minutes * 60_000 } : {}),
            ...(mode === null ? {} : { writingMode: mode as ProductionRequest['writingMode'] }),
            ...(personaId === null ? {} : { personaId }),
        });
    };

    return (
        <Card>
            <Stack gap="md">
                {error !== null && error !== undefined && <ErrorAlert title="Could not ask for that production" error={error} />}

                <TextInput
                    label="Called"
                    description="What this one is, for the console and for its beats' own labels."
                    placeholder="The machine nobody wanted"
                    value={title}
                    onChange={event => setTitle(event.currentTarget.value)}
                    required
                />

                <Textarea
                    label="What it should be about"
                    description="In your own words. This is what the planning pass actually works from, and it matters far more than the title does."
                    placeholder="The history of the TR-808: why it flopped, who rescued it, and what it did to pop music."
                    value={brief}
                    onChange={event => setBrief(event.currentTarget.value)}
                    autosize
                    minRows={3}
                />

                <Group grow align="flex-start">
                    <TextInput
                        label="Kind"
                        description="Free text, and what a clock band names."
                        value={kind}
                        onChange={event => setKind(event.currentTarget.value)}
                    />
                    <NumberInput
                        label="Minutes"
                        description="Leave empty for the station's default. This decides how many beats it has."
                        min={1}
                        value={minutes}
                        onChange={setMinutes}
                    />
                </Group>

                <Group grow align="flex-start">
                    <Select
                        label="How much to write it"
                        description="Leave empty for the station's default."
                        data={MODES}
                        value={mode}
                        onChange={setMode}
                        clearable
                    />
                    <Select
                        label="Presenter"
                        description="Leave empty and whoever is on air when a pass runs presents it."
                        data={(personas.data?.personas ?? []).map(persona => ({ value: persona.id, label: persona.label }))}
                        value={personaId}
                        onChange={setPersonaId}
                        clearable
                        searchable
                    />
                </Group>

                <Group justify="flex-end">
                    <Button variant="subtle" onClick={onCancel} disabled={pending}>
                        Cancel
                    </Button>
                    <Button onClick={submit} loading={pending} disabled={title.trim().length === 0}>
                        Ask for it
                    </Button>
                </Group>
            </Stack>
        </Card>
    );
}
