import { SimpleGrid, Textarea } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import { useTranslation } from 'react-i18next';

import { type FormValues, Section, TEMPLATE_EXAMPLES, TemplateFaults } from './persona.editor.helpers';
import { QuirksField } from './persona.quirks.field';

interface Props {
    form: UseFormReturnType<FormValues>;
    hosting: boolean;
}

/** Split out of `persona.editor.tsx` unchanged: the Talk section of the sheet, on the sheet's one form. */
export function PersonaEditorTalk({ form, hosting }: Props) {
    const { t } = useTranslation('personas');

    return (
        <>
            <Section title={t('editor.section.talk.title')} blurb={t('editor.section.talk.blurb')} />

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
