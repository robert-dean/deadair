import { Box, SimpleGrid, Text, Textarea, TextInput } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import { useTranslation } from 'react-i18next';

import { type FormValues, Section, TEMPLATE_EXAMPLES, TemplateFaults } from './persona.editor.helpers';
import { QuirksField } from './persona.quirks.field';
import { languageLabel, sheetMatches, stationLanguageOf } from './sheet.language';
import { useSettings } from '../../api/settings.queries';
import { ErrorAlert } from '../shared/error.alert';

interface Props {
    form: UseFormReturnType<FormValues>;
    hosting: boolean;
}

/** Split out of `persona.editor.tsx` unchanged: the Talk section of the sheet, on the sheet's one form. */
export function PersonaEditorTalk({ form, hosting }: Props) {
    const { t } = useTranslation('personas');
    const settings = useSettings();
    // Only once the settings are read, so the warning never flashes up against an assumed English.
    const setting = settings.data?.values['stream.language'];
    const station = settings.data === undefined ? undefined : stationLanguageOf(setting);
    const sheet = form.getValues().sheetLanguage;

    return (
        <>
            <Section title={t('editor.section.talk.title')} blurb={t('editor.section.talk.blurb')} />

            <TextInput
                label={t('editor.field.sheetLanguage.label')}
                description={t('editor.field.sheetLanguage.description')}
                placeholder={t('editor.field.sheetLanguage.placeholder')}
                maw={320}
                {...form.getInputProps('sheetLanguage')}
            />

            {/* What the station does with a sheet in another language is invisible from the sheet: the
                words are all still here, and the presenter is simply never shown them. So it is said.
                In a Box because the form is a scrolling flex column and an Alert hides its overflow,
                which lets the column shrink it to its title. */}
            {station === undefined || sheetMatches(sheet, station) ? undefined : (
                <Box>
                    <ErrorAlert
                        tone="warning"
                        title={t('editor.sheetLanguage.title', { sheet: languageLabel(sheet), station: languageLabel(station) })}
                    >
                        <Text size="sm">{t('editor.sheetLanguage.body')}</Text>
                    </ErrorAlert>
                </Box>
            )}

            <Textarea
                label={t('editor.field.diction.label')}
                description={t('editor.field.diction.description')}
                placeholder={t('editor.field.diction.placeholder')}
                autosize
                minRows={5}
                maxRows={14}
                {...form.getInputProps('diction')}
            />

            <Textarea
                label={t('editor.field.markers.label')}
                description={t('editor.field.markers.description')}
                placeholder={t('editor.field.markers.placeholder')}
                autosize
                minRows={4}
                maxRows={12}
                {...form.getInputProps('dictionMarkers')}
            />

            <QuirksField rows={form.getValues().quirks} onChange={rows => form.setFieldValue('quirks', rows)} />

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Textarea
                    label={t('editor.field.catchphrases.label')}
                    description={t('editor.field.catchphrases.description')}
                    autosize
                    minRows={3}
                    maxRows={10}
                    {...form.getInputProps('catchphrases')}
                />
                <Textarea
                    label={t('editor.field.avoid.label')}
                    description={t('editor.field.avoid.description')}
                    autosize
                    minRows={3}
                    maxRows={10}
                    {...form.getInputProps('avoid')}
                />
            </SimpleGrid>

            <Textarea
                label={t('editor.field.exclusive.label')}
                description={t('editor.field.exclusive.description')}
                placeholder={t('editor.field.exclusive.placeholder')}
                autosize
                minRows={3}
                maxRows={10}
                {...form.getInputProps('exclusiveSubjects')}
            />

            {/* Only somebody who presents has a floor: phrasings are what the STATION says
                when the model declines, and a phone-in whose caller was written by a template
                is a phone-in with nobody on the phone. So the section is not drawn for a
                character who only rings in or drops by, rather than drawn and ignored. */}
            {hosting ? (
                <>
                    <Section title={t('editor.section.fallback.title')} blurb={t('editor.section.fallback.blurb')} />

                    <Textarea
                        label={t('editor.field.templates.label')}
                        // The station's own placeholders, shown as text rather than filled in.
                        description={t('editor.field.templates.description', TEMPLATE_EXAMPLES)}
                        placeholder={t('editor.field.templates.placeholder', TEMPLATE_EXAMPLES)}
                        autosize
                        minRows={6}
                        maxRows={16}
                        {...form.getInputProps('templates')}
                    />

                    <TemplateFaults raw={form.values.templates} />
                </>
            ) : undefined}

            <Textarea
                label={t('editor.field.samples.label')}
                description={t('editor.field.samples.description')}
                autosize
                minRows={3}
                maxRows={10}
                {...form.getInputProps('samples')}
            />
        </>
    );
}
