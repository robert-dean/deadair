import { ActionIcon, Checkbox, MultiSelect, Pill, SimpleGrid, Stack, TextInput, Textarea } from '@mantine/core';
import { IconDice5 } from '@tabler/icons-react';
import type { UseFormReturnType } from '@mantine/form';
import type { Persona } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { suggestAirName } from './air.names';
import { type FormValues, Section } from './persona.editor.helpers';
import { personaKeyFor } from './persona.key';
import { PERSONA_KINDS } from './persona.kind';
import { PersonaPortrait } from './persona.portrait';

interface Props {
    form: UseFormReturnType<FormValues>;
    persona: Persona | undefined;
    ownKey: boolean;
    setOwnKey: (own: boolean) => void;
    hosting: boolean;
    guest: boolean;
    appears: boolean;
    newsreader: Persona | undefined;
    hostOptions: { value: string; label: string }[];
    hostLabel: (id: string | undefined) => string;
}

/** Split out of `persona.editor.tsx` unchanged: the Who section of the sheet, on the sheet's one form. */
export function PersonaEditorWho({ form, persona, ownKey, setOwnKey, hosting, guest, appears, newsreader, hostOptions, hostLabel }: Props) {
    const { t } = useTranslation('personas');

    return (
        <>
            <Section title={t('editor.section.who.title')} blurb={t('editor.section.who.blurb')} />

            {/* Both halves carry a description, which is not padding: one field had one and
                the other did not, so the two inputs sat eighteen pixels apart on a row that
                is meant to read as one. */}
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <TextInput
                    label={t('editor.field.name.label')}
                    description={t('editor.field.name.description')}
                    placeholder={t('editor.field.name.placeholder')}
                    {...form.getInputProps('label')}
                    // The key follows the name until somebody says otherwise, which is what
                    // makes the field beside this one something to skip rather than something
                    // to invent. Never on an existing character: the key is what
                    // `script_history` stamps, so moving it silently under a rename would
                    // detach a character from everything it has said.
                    onChange={event => {
                        const written = event.currentTarget.value;
                        form.setFieldValue('label', written);
                        if (!ownKey) form.setFieldValue('key', personaKeyFor(written));
                    }}
                />
                <TextInput
                    label={t('editor.field.key.label')}
                    description={ownKey ? t('editor.field.key.descriptionOwn') : t('editor.field.key.descriptionDerived')}
                    {...form.getInputProps('key')}
                    onChange={event => {
                        setOwnKey(true);
                        form.setFieldValue('key', event.currentTarget.value);
                    }}
                />
            </SimpleGrid>

            <Checkbox.Group
                label={t('editor.field.kinds.label')}
                description={t('editor.field.kinds.description')}
                {...form.getInputProps('kinds')}
                // Kept in the API's order whatever order they were ticked in, so the card's
                // heading and badges read the same way the station ranks them.
                onChange={value =>
                    form.setFieldValue(
                        'kinds',
                        PERSONA_KINDS.filter(option => value.includes(option)),
                    )
                }
            >
                <Stack gap="xs" mt="xs">
                    {PERSONA_KINDS.map(option => (
                        <Checkbox
                            key={option}
                            value={option}
                            label={t(`editor.field.kinds.${option}.label`)}
                            description={
                                option === 'newsreader' && newsreader !== undefined
                                    ? t('editor.field.kinds.newsreader.taken', { name: newsreader.label })
                                    : t(`editor.field.kinds.${option}.description`)
                            }
                            disabled={option === 'newsreader' && newsreader !== undefined && !form.values.kinds.includes('newsreader')}
                        />
                    ))}
                </Stack>
            </Checkbox.Group>

            {/* Only somebody who presents and exists: a caller never presents, and a persona
                not saved yet has no id for a picture to belong to. */}
            {persona !== undefined && hosting ? <PersonaPortrait personaId={persona.id} name={persona.label} /> : undefined}

            <Textarea
                label={t('editor.field.style.label')}
                description={t('editor.field.style.description')}
                placeholder={t('editor.field.style.placeholder')}
                autosize
                minRows={2}
                maxRows={8}
                {...form.getInputProps('style')}
            />

            <TextInput
                label={t('editor.field.djName.label')}
                description={t('editor.field.djName.description')}
                {...form.getInputProps('djName')}
                // Inside the field rather than beside it, so the suggestion lands where the
                // operator is already looking. A button rather than a pre-filled value:
                // empty means "keep the station's name", which is a real answer and not one
                // a suggestion may quietly overwrite.
                rightSection={
                    <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label={t('editor.field.djName.suggest')}
                        title={t('editor.field.djName.suggest')}
                        onClick={() => {
                            form.setFieldValue('djName', suggestAirName(form.getValues().djName));
                        }}
                    >
                        <IconDice5 size={16} stroke={1.8} />
                    </ActionIcon>
                }
            />

            <Textarea
                label={t('editor.field.background.label')}
                description={t('editor.field.background.description')}
                autosize
                minRows={2}
                maxRows={8}
                {...form.getInputProps('background')}
            />

            {/* Callers only, the other way round from the phrasings below, which only a host has.
                A tie is a restriction: a caller with hosts here rings in to nobody else's
                programme, and one with none rings in to anybody's. */}
            {appears ? (
                <>
                    <Section
                        title={guest ? t('editor.section.visit.title') : t('editor.section.ring.title')}
                        blurb={guest ? t('editor.section.visit.blurb') : t('editor.section.ring.blurb')}
                    />
                    <MultiSelect
                        // One tie list narrows both jobs, so it is worded for the one they do.
                        label={form.values.kinds.includes('caller') ? t('editor.field.hosts.label') : t('editor.field.hosts.visitLabel')}
                        description={
                            form.values.kinds.includes('caller') ? t('editor.field.hosts.description') : t('editor.field.hosts.visitDescription')
                        }
                        data={hostOptions}
                        searchable
                        clearable
                        // Labelled for the reason `config.fields.form.tsx` labels its tag pills:
                        // Mantine hides a pill's remove button from the accessibility tree, and
                        // it is still the only way a host is dropped with a mouse.
                        renderPill={({ value, onRemove, disabled }) => (
                            <Pill
                                withRemoveButton={!disabled}
                                onRemove={onRemove}
                                removeButtonProps={{ 'aria-label': t('editor.field.hosts.remove', { label: hostLabel(value) }) }}
                            >
                                {hostLabel(value)}
                            </Pill>
                        )}
                        {...form.getInputProps('hosts')}
                    />
                </>
            ) : undefined}
        </>
    );
}
