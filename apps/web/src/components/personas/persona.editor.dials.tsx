import { ActionIcon, Autocomplete, Select, SimpleGrid, Text, TextInput, Textarea } from '@mantine/core';
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import type { UseFormReturnType } from '@mantine/form';
import { useTranslation } from 'react-i18next';

import { fetchVoiceSample } from '../../api/voices.queries';
import type { useVoicePreview } from '../voices/voice.preview';
import { DIAL, type FormValues, Section, UnusedMarkers, voiceReadout } from './persona.editor.helpers';

interface Props {
    form: UseFormReturnType<FormValues>;
    voiceOptions: { value: string; label: string }[];
    boardOptions: string[];
    preview: ReturnType<typeof useVoicePreview>;
}

/** Split out of `persona.editor.tsx` unchanged: the Dials section of the sheet, on the sheet's one form. */
export function PersonaEditorDials({ form, voiceOptions, boardOptions, preview }: Props) {
    const { t } = useTranslation('personas');

    return (
        <>
            <Section title={t('editor.section.dials.title')} blurb={t('editor.section.dials.blurb')} />

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                {voiceOptions.length > 0 ? (
                    <Select
                        label={t('editor.field.voice.label')}
                        description={t('editor.field.voice.description')}
                        data={voiceOptions}
                        clearable
                        searchable
                        // A voice is chosen by ear or not at all: a list of station names is
                        // a list of words this station made up, and nothing in it says what
                        // any of them sound like. The button previews whatever is selected.
                        rightSection={
                            form.values.voice ? (
                                <ActionIcon
                                    variant="subtle"
                                    size="sm"
                                    loading={preview.isLoading(form.values.voice)}
                                    aria-label={t('editor.field.voice.play')}
                                    onClick={() =>
                                        preview.play(form.values.voice, () => fetchVoiceSample(form.values.voice), t('shared.voicePreviewFailed'))
                                    }
                                >
                                    {preview.isPlaying(form.values.voice) ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
                                </ActionIcon>
                            ) : undefined
                        }
                        {...form.getInputProps('voice')}
                    />
                ) : (
                    <TextInput
                        label={t('editor.field.voice.label')}
                        description={t('editor.field.voice.descriptionUnmapped')}
                        {...form.getInputProps('voice')}
                    />
                )}
                {/* An autocomplete rather than a Select, on the voices map's rule: the list is
                    what the station currently holds, and a set an operator is about to make
                    has to stay typeable. Naming a set that does not exist is a rack that is
                    empty, which `PadRepository.onSet` answers identically to a set holding
                    nothing — deliberately, because both are a presenter with nothing to
                    reach for. */}
                <Autocomplete
                    label={t('editor.field.soundboard.label')}
                    description={t('editor.field.soundboard.description')}
                    data={boardOptions}
                    {...form.getInputProps('soundboard')}
                />
            </SimpleGrid>

            {/* A grid rather than `Group grow`. Four controls across a 620px sheet is 110px
                each, which is narrower than every one of these options: all four read
                "The station's u…" and an operator could not see what any of them was set
                to. The descriptions are also four different heights, so the row put its
                four dropdowns at four different altitudes and read as broken. A grid fixes
                both at once — two per row is wide enough for the longest option, and grid
                rows align their tracks whatever the prose above does. */}
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="md">
                <Select
                    {...DIAL}
                    label={t('editor.dial.brevity.label')}
                    description={t('editor.dial.brevity.description')}
                    data={[
                        { value: '', label: t('editor.dial.brevity.usual') },
                        { value: 'short', label: t('editor.dial.brevity.short') },
                        { value: 'one-line', label: t('editor.dial.brevity.oneLine') },
                    ]}
                    {...form.getInputProps('brevity')}
                />

                <Select
                    {...DIAL}
                    label={t('editor.dial.latitude.label')}
                    description={t('editor.dial.latitude.description')}
                    data={[
                        { value: '', label: t('editor.dial.latitude.usual') },
                        { value: 'loose', label: t('editor.dial.latitude.loose') },
                        { value: 'unleashed', label: t('editor.dial.latitude.unleashed') },
                    ]}
                    {...form.getInputProps('latitude')}
                />

                <Select
                    {...DIAL}
                    label={t('editor.dial.trivia.label')}
                    description={t('editor.dial.trivia.description')}
                    data={[
                        { value: '', label: t('editor.dial.trivia.usual') },
                        { value: 'sometimes', label: t('editor.dial.trivia.sometimes') },
                        { value: 'always', label: t('editor.dial.trivia.always') },
                        { value: 'keen', label: t('editor.dial.trivia.keen') },
                        { value: 'never', label: t('editor.dial.trivia.never') },
                    ]}
                    {...form.getInputProps('trivia')}
                />

                <Select
                    {...DIAL}
                    label={t('editor.dial.storytelling.label')}
                    description={t('editor.dial.storytelling.description')}
                    data={[
                        { value: '', label: t('editor.dial.storytelling.occasionally') },
                        { value: 'often', label: t('editor.dial.storytelling.often') },
                        { value: 'never', label: t('editor.dial.storytelling.never') },
                    ]}
                    {...form.getInputProps('storytelling')}
                />

                <Select
                    {...DIAL}
                    label={t('editor.dial.growth.label')}
                    description={t('editor.dial.growth.description')}
                    data={[
                        { value: '', label: t('editor.dial.growth.proposes') },
                        { value: 'self-directed', label: t('editor.dial.growth.selfDirected') },
                    ]}
                    {...form.getInputProps('growth')}
                />

                <Select
                    {...DIAL}
                    label={t('editor.dial.chattiness.label')}
                    description={t('editor.dial.chattiness.description')}
                    data={[
                        { value: '', label: t('editor.dial.chattiness.ordinary') },
                        { value: 'relentless', label: t('editor.dial.chattiness.relentless') },
                        { value: 'chatty', label: t('editor.dial.chattiness.chatty') },
                        { value: 'sparing', label: t('editor.dial.chattiness.sparing') },
                        { value: 'reserved', label: t('editor.dial.chattiness.reserved') },
                    ]}
                    {...form.getInputProps('chattiness')}
                />
            </SimpleGrid>

            {/* The two compose, and neither control can say so on its own: a terse character
                can be unfiltered, and reading the pair back is the only way an operator sees
                what they have actually asked for. Each field's own description explains what
                it does; this says what the combination comes to. */}
            <Text size="xs" c="dimmed">
                {voiceReadout(form.values.brevity, form.values.latitude, form.values.storytelling, form.values.chattiness, form.values.trivia, t)}
            </Text>

            <Textarea
                label={t('editor.field.preoccupations.label')}
                description={t('editor.field.preoccupations.description')}
                placeholder={t('editor.field.preoccupations.placeholder')}
                autosize
                minRows={4}
                maxRows={12}
                {...form.getInputProps('preoccupations')}
            />

            <UnusedMarkers markers={form.values.dictionMarkers} samples={form.values.samples} />
        </>
    );
}
