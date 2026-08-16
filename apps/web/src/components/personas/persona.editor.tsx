import { useState } from 'react';
import { Alert, Button, Card, Group, Modal, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { Persona, PersonaDraftView, PersonaInput } from '@deadair/sdk';

import { useGeneratePersona } from '../../api/personas.queries';
import { useVoices } from '../../api/voices.queries';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';

/**
 * Writing one persona.
 *
 * ## Every list field is a textarea, one entry per line
 *
 * The same affordance the break phrasings already use, so nobody learns a second one — and it is
 * the right one anyway: a quirk and a line of diction are sentences, and a tag input would invite
 * an operator to type them as words. The conversion is here rather than in the API, which takes
 * arrays, because "one per line" is a decision about a text box.
 *
 * ## The voice is a picker over what the engine actually has
 *
 * A voice id means nothing to the host — the speech plugin maps it — so the only place the real
 * list exists is `GET /voices`. When no speech plugin can answer, the field falls back to a plain
 * text box rather than disappearing: a station configuring its personas before its voice is a
 * perfectly ordinary order to do things in, and hiding the field would lose what they typed.
 *
 * ## A description fills the form in, and only on a NEW persona
 *
 * The fourteen boxes below are the reason the station shipped ten personas and no eleventh, so the
 * model is offered as a way of filling them rather than as a way of saving one: what comes back
 * lands in the fields and the operator saves it themselves, edits and all.
 *
 * Offered only when writing a new one, deliberately. On an existing persona the same button would
 * overwrite an operator's own work with no way back, and "regenerate this character" is a different
 * feature from "start me off".
 */
export function PersonaEditor({ persona, opened, onClose, onSubmit, saving, error }: Props) {
    const voices = useVoices(opened);
    const generate = useGeneratePersona();
    const [description, setDescription] = useState('');

    const form = useForm<FormValues>({
        initialValues: valuesOf(persona),
        // Recreated on open rather than kept: the modal is the only place these are edited, so a
        // form surviving a close is a form holding a persona nobody is looking at any more.
        enhanceGetInputProps: () => ({}),
        validate: {
            key: value => (value.trim().length === 0 ? 'A persona needs a key' : undefined),
            label: value => (value.trim().length === 0 ? 'A persona needs a name' : undefined),
            style: value => (value.trim().length === 0 ? 'Say who this character is' : undefined),
        },
    });

    const voiceOptions = (voices.data?.voices ?? []).map(voice => ({ value: voice.id, label: voice.label }));

    return (
        <Modal opened={opened} onClose={onClose} title={persona === undefined ? 'New persona' : `Edit ${persona.label}`} size="xl">
            <form onSubmit={form.onSubmit(values => onSubmit(draftOf(values)))}>
                <Stack gap="md">
                    {error === undefined ? undefined : (
                        <ErrorAlert title="That could not be saved" error={error} fallback="The persona could not be saved." />
                    )}

                    {persona === undefined ? (
                        <Card withBorder padding="sm">
                            <Stack gap="xs">
                                <Eyebrow>Start from a description</Eyebrow>
                                <Textarea
                                    placeholder="a 1970s northern soul DJ who broadcasts from the back of a chip shop"
                                    description="Fills in the fields below. Nothing is saved until you press Save, and you can change any of it first."
                                    rows={2}
                                    value={description}
                                    onChange={event => setDescription(event.currentTarget.value)}
                                />
                                {/* Truthiness rather than `=== undefined`: a mutation that has never
                                    failed carries `error: null`, so an identity check against
                                    undefined renders the alert on every success. */}
                                {generate.error ? (
                                    <ErrorAlert
                                        title="Nothing was written"
                                        error={generate.error}
                                        fallback="The station could not write a persona. Your own fields are untouched."
                                    />
                                ) : undefined}
                                {generate.data ? <GenerationNotes generated={generate.data} /> : undefined}
                                <Group justify="flex-end">
                                    <Button
                                        variant="light"
                                        loading={generate.isPending}
                                        // Disabled while one is in flight as well as while there is
                                        // nothing to send. A second press starts a second generation
                                        // whose answer can land after the first, which shows an
                                        // operator the older of the two outcomes.
                                        disabled={description.trim().length === 0 || generate.isPending}
                                        onClick={() =>
                                            generate.mutate(description, {
                                                // Straight into the fields. Nothing is saved and nothing is
                                                // locked: what arrives is a starting point to edit.
                                                onSuccess: written => form.setValues(valuesOf(written.persona)),
                                            })
                                        }
                                    >
                                        Write me one
                                    </Button>
                                </Group>
                            </Stack>
                        </Card>
                    ) : undefined}

                    <Group grow align="flex-start">
                        <TextInput label="Name" placeholder="Late-night companion" {...form.getInputProps('label')} />
                        <TextInput label="Key" description="A short slug, unique to this station." {...form.getInputProps('key')} />
                    </Group>

                    <Textarea
                        label="Who they are"
                        description='Completes "You are …". Who they ARE; how they talk is below.'
                        placeholder="a quiet late-night host sitting close to the mic"
                        rows={2}
                        {...form.getInputProps('style')}
                    />

                    <Group grow align="flex-start">
                        <TextInput
                            label="On-air name"
                            description="Overrides the station's presenter name while this persona is on air. Leave empty to keep it."
                            {...form.getInputProps('djName')}
                        />
                        {voiceOptions.length > 0 ? (
                            <Select
                                label="Voice"
                                description="Leave empty for whatever the speech plugin uses by default."
                                data={voiceOptions}
                                clearable
                                searchable
                                {...form.getInputProps('voice')}
                            />
                        ) : (
                            <TextInput
                                label="Voice"
                                description="No speech plugin is answering, so this is the id as your engine will map it."
                                {...form.getInputProps('voice')}
                            />
                        )}
                    </Group>

                    <Textarea
                        label="How they speak"
                        description="The dialect, one rule per line. This applies to EVERY sentence, including the ones stating a plain fact."
                        placeholder={'Always contract: "you\'re", "that\'s"\nSpeak to one person, not a crowd'}
                        rows={5}
                        {...form.getInputProps('diction')}
                    />

                    <Textarea
                        label="Words that prove it"
                        description="One per line. A break that comes back carrying none of these is treated as out of character and the phrasings below write it instead. An entry ending in an apostrophe matches as a suffix, so in' catches every dropped g. Leave empty to check nothing."
                        placeholder={"ye\naye\nmatey\nin'"}
                        rows={4}
                        {...form.getInputProps('dictionMarkers')}
                    />

                    <Textarea
                        label="In character"
                        description="What they always and never do on air, one per line."
                        rows={4}
                        {...form.getInputProps('quirks')}
                    />

                    <Group grow align="flex-start">
                        <Textarea
                            label="Signature phrases"
                            description="One per line. Asked for sparingly: at most one, and not every break."
                            rows={3}
                            {...form.getInputProps('catchphrases')}
                        />
                        <Textarea label="Never say" description="One per line." rows={3} {...form.getInputProps('avoid')} />
                    </Group>

                    <Select
                        label="How much they say"
                        description="Only shorter than the station's usual, because the length of a break is set by where the model stops rather than by the ceiling. It asks for less; nothing refuses a break for running past it."
                        data={[
                            { value: '', label: "The station's usual" },
                            { value: 'short', label: 'Says less — a sentence or two' },
                            { value: 'one-line', label: 'Says almost nothing — one line' },
                        ]}
                        allowDeselect={false}
                        {...form.getInputProps('brevity')}
                    />

                    <Textarea
                        label="True about them"
                        description="A couple of grounded facts they may mention about themselves."
                        rows={2}
                        {...form.getInputProps('background')}
                    />

                    <Textarea
                        label="Lines in their voice"
                        description="One per line. Used as examples for the model, which is asked to reuse the grammar and never the sentences."
                        rows={3}
                        {...form.getInputProps('samples')}
                    />

                    <Textarea
                        label="Their own phrasings"
                        description="One per line, in the same syntax as the station's break phrasings. These are what the station says when the model declines, which is most breaks — so a character with none falls back to plain English."
                        placeholder="That was {{previous.title}}, from {{previous.artist}}.[[ Next up, {{next.title}}.]]"
                        rows={6}
                        {...form.getInputProps('templates')}
                    />

                    <Textarea
                        label="What they play"
                        description="In your own words, for the model that chooses records. It is used only when a broadcast was not briefed: brief the station and this is ignored entirely, so the persona is purely the presenter."
                        rows={3}
                        {...form.getInputProps('music')}
                    />

                    <Group justify="space-between">
                        <Text c="dimmed" size="xs">
                            Nothing here can loosen the rules the station always sends: never name a record it was not given, and be certain or say
                            nothing.
                        </Text>
                        <Group>
                            <Button variant="subtle" onClick={onClose}>
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
 * What the station had to drop out of what the model wrote.
 *
 * Shown rather than quietly applied, because both of these are things an operator would otherwise
 * discover by putting the persona on air: a marker nothing says declines every break, and a phrasing
 * naming a value that does not exist is never picked. Neither looks like a fault from the outside —
 * they look like a model that is switched off and a phrasing the station never happens to choose.
 */
function GenerationNotes({ generated }: { generated: { droppedMarkers: string[]; droppedTemplates: string[] } }) {
    if (generated.droppedMarkers.length === 0 && generated.droppedTemplates.length === 0) return undefined;

    return (
        <Alert color="yellow" variant="light" title="Some of it was dropped">
            <Stack gap={4}>
                {generated.droppedMarkers.length === 0 ? undefined : (
                    <Text size="sm">
                        The model called these words its own and then never used them, so they were left out:{' '}
                        {generated.droppedMarkers.join(', ')}. A word the character does not actually say would refuse every break it writes.
                    </Text>
                )}
                {generated.droppedTemplates.length === 0 ? undefined : (
                    <Text size="sm">
                        {generated.droppedTemplates.length} phrasing{generated.droppedTemplates.length === 1 ? '' : 's'} named something the station
                        cannot fill in, so {generated.droppedTemplates.length === 1 ? 'it was' : 'they were'} left out.
                    </Text>
                )}
            </Stack>
        </Alert>
    );
}

interface Props {
    /** The persona being edited, or absent for a new one. */
    persona?: Persona;
    opened: boolean;
    onClose: () => void;
    onSubmit: (draft: PersonaInput) => void;
    saving: boolean;
    error?: unknown;
}

/** The form's own shape: every list field is one string, one entry per line. */
interface FormValues {
    key: string;
    label: string;
    style: string;
    djName: string;
    voice: string;
    background: string;
    brevity: string;
    templates: string;
    music: string;
    diction: string;
    dictionMarkers: string;
    quirks: string;
    catchphrases: string;
    avoid: string;
    samples: string;
}

const linesOf = (values: string[] | undefined): string => (values ?? []).join('\n');

/**
 * A saved persona or a generated draft, as the form's values.
 *
 * Takes the DRAFT shape rather than `Persona`, since a saved one is that plus `id` and `active` and
 * this reads neither. That is what lets one function serve opening an existing persona and dropping
 * a generated one into the same fields.
 */
function valuesOf(persona: PersonaDraftView | undefined): FormValues {
    return {
        key: persona?.key ?? '',
        label: persona?.label ?? '',
        style: persona?.style ?? '',
        djName: persona?.djName ?? '',
        voice: persona?.voice ?? '',
        background: persona?.background ?? '',
        brevity: persona?.brevity ?? '',
        templates: persona?.templates ?? '',
        music: persona?.music ?? '',
        diction: linesOf(persona?.diction),
        dictionMarkers: linesOf(persona?.dictionMarkers),
        quirks: linesOf(persona?.quirks),
        catchphrases: linesOf(persona?.catchphrases),
        avoid: linesOf(persona?.avoid),
        samples: linesOf(persona?.samples),
    };
}

/**
 * The form as the API takes it.
 *
 * An empty field is left OUT rather than sent as an empty string, which is what makes "clear the
 * on-air name" mean "fall back to the station's" rather than "the presenter is called nothing".
 */
function draftOf(values: FormValues): PersonaInput {
    const list = (raw: string): string[] | undefined => {
        const lines = raw
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        return lines.length === 0 ? undefined : lines;
    };
    const text = (raw: string): string | undefined => (raw.trim().length === 0 ? undefined : raw.trim());
    // Annotated and lifted out of the literal below, because inside it the narrowed union widens
    // back to `string` on its way through `omitUndefined`'s inference.
    const brevity: PersonaInput['brevity'] = values.brevity === 'short' || values.brevity === 'one-line' ? values.brevity : undefined;

    return {
        key: values.key.trim(),
        label: values.label.trim(),
        style: values.style.trim(),
        ...omitUndefined({
            djName: text(values.djName),
            voice: text(values.voice),
            background: text(values.background),
            // '' is the station's usual length, which is an ABSENT field rather than a rung — the
            // same rule the on-air name follows.
            brevity,
            // Not trimmed per line: the phrasings are parsed by the API the same way the station's
            // own setting is, and a blank line between two of them is somebody spacing their list.
            templates: text(values.templates),
            music: text(values.music),
            diction: list(values.diction),
            dictionMarkers: list(values.dictionMarkers),
            quirks: list(values.quirks),
            catchphrases: list(values.catchphrases),
            avoid: list(values.avoid),
            samples: list(values.samples),
        }),
    };
}

function omitUndefined<T extends Record<string, unknown>>(values: T): Partial<T> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}
