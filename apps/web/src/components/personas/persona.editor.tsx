import { Alert, Button, Group, Modal, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { Persona, PersonaInput } from '@deadair/sdk';

import { useVoices } from '../../api/voices.queries';
import { apiErrorMessage } from '../../api/sdk.error';

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
 */
export function PersonaEditor({ persona, opened, onClose, onSubmit, saving, error }: Props) {
    const voices = useVoices(opened);

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
                        <Alert color="red" title="That could not be saved">
                            {apiErrorMessage(error, 'The persona could not be saved.')}
                        </Alert>
                    )}

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
                        description="One per line. A break that comes back carrying fewer than two of these is treated as out of character and the phrasings below write it instead. An entry ending in an apostrophe matches as a suffix, so in' catches every dropped g. Leave empty to check nothing."
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

function valuesOf(persona: Persona | undefined): FormValues {
    return {
        key: persona?.key ?? '',
        label: persona?.label ?? '',
        style: persona?.style ?? '',
        djName: persona?.djName ?? '',
        voice: persona?.voice ?? '',
        background: persona?.background ?? '',
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

    return {
        key: values.key.trim(),
        label: values.label.trim(),
        style: values.style.trim(),
        ...omitUndefined({
            djName: text(values.djName),
            voice: text(values.voice),
            background: text(values.background),
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
