import { useState } from 'react';
import { Button, Card, Drawer, Group, Stack, Text, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { Persona, PersonaInput } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { useGeneratePersona, usePersonas, useRehearsePersona } from '../../api/personas.queries';
import { usePads } from '../../api/pads.queries';
import { usePhone } from '../shared/use.phone';
import { hasKind, presents, type PersonaKind } from './persona.kind';
import { useVoices } from '../../api/voices.queries';
import { useVoicePreview } from '../voices/voice.preview';
import { PersonaEditorDials } from './persona.editor.dials';
import { draftOf, type FormValues, GenerationNotes, titleFor, VALIDATED, valuesOf } from './persona.editor.helpers';
import { PersonaEditorTalk } from './persona.editor.talk';
import { PersonaEditorWho } from './persona.editor.who';
import { PersonaRehearsalPanel } from './persona.rehearsal';
import { ConfirmModal } from '../shared/confirm.modal';
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
 *
 * ## Every textarea autosizes, and that is about the SCROLL rather than about the box
 *
 * Ten boxes at a fixed `rows` all overflowed their own content, and each one is a scroll container
 * the wheel is captured by. Working down this sheet, the page stopped dead every time the cursor
 * crossed a field — which on a column that is almost entirely fields is most of the way down it.
 * Autosizing removes the inner scrollbar for anything short of `maxRows`, so the wheel reaches the
 * sheet, and it has the second effect of showing a list whole rather than four lines of it.
 *
 * ## Nothing pressed in the footer can fail out of sight
 *
 * The three validated fields are the first three, the save error was above them, and Save is pinned
 * to the bottom — so from where an operator actually stands, both ways a save can fail looked like a
 * button that does nothing. The error moved to the footer and a failed validation scrolls its field
 * back on screen. Neither is decoration: this was the sheet's only silent failure and it had two
 * doors.
 */
export function PersonaEditor({ persona, kind, opened, onClose, onSubmit, saving, error }: Props) {
    const phone = usePhone();
    const { t } = useTranslation('personas');
    const voices = useVoices(opened);
    const pads = usePads();
    // The roster, for the hosts a caller may ring in to. Already cached by the page this opens from.
    const personas = usePersonas();
    const generate = useGeneratePersona();
    const preview = useVoicePreview();
    const rehearse = useRehearsePersona();
    const [description, setDescription] = useState('');
    // Whether closing is being questioned rather than done. Only ever true with unsaved work in the
    // fields; see `requestClose`.
    const [discarding, setDiscarding] = useState(false);
    // Whether the key is the operator's own word or one this form derived from the name. State rather
    // than a ref because the field's own description says which of the two it is, so flipping it has
    // to redraw. It is deliberately NOT a comparison against the derived value: an operator who
    // happens to type the slug this would have written still owns it, and would otherwise watch it
    // follow the name they typed next.
    const [ownKey, setOwnKey] = useState(persona !== undefined);

    const form = useForm<FormValues>({
        initialValues: valuesOf(persona, kind),
        // Recreated on open rather than kept: the modal is the only place these are edited, so a
        // form surviving a close is a form holding a persona nobody is looking at any more.
        enhanceGetInputProps: () => ({}),
        validate: {
            kinds: value => (value.length === 0 ? t('editor.validate.kinds') : undefined),
            key: value => (value.trim().length === 0 ? t('editor.validate.key') : undefined),
            label: value => (value.trim().length === 0 ? t('editor.validate.label') : undefined),
            style: value => (value.trim().length === 0 ? t('editor.validate.style') : undefined),
        },
    });

    // What this character does, which decides which halves of the sheet are drawn. A field rather than
    // fixed, because a character may do several things: phrasings and a portrait belong to whoever
    // presents, and ties to whoever rings in or drops by, so a host who also drops by has both.
    const hosting = form.values.kinds.includes('host');
    const guest = form.values.kinds.includes('guest');
    const appears = guest || form.values.kinds.includes('caller');
    // The newsreader is one per station, so the box is closed while somebody else holds it.
    const newsreader = (personas.data?.personas ?? []).find(other => other.id !== persona?.id && hasKind(other, 'newsreader'));

    // Hosts only, through `presents`: a caller ringing in to another caller is a tie the API refuses,
    // and offering it would be a form that cannot be saved.
    const hostOptions = (personas.data?.personas ?? [])
        // Never themselves: a host who also drops by is cast onto nobody's show but other people's.
        .filter(host => presents(host) && host.id !== persona?.id)
        .map(host => ({ value: host.id, label: host.label }));
    const hostLabel = (id: string | undefined) => hostOptions.find(option => option.value === id)?.label ?? id ?? '';

    const voiceOptions = (voices.data?.voices ?? []).map(voice => ({ value: voice.id, label: voice.label }));

    // The SETS, which is what `soundboard` names. Not derived from the pads any more: a set is a row
    // now, and an empty one is a real thing to offer — it is what a set looks like before anybody has
    // dropped a file, and pointing a character at it first is a perfectly ordinary order to do this
    // in.
    const boardOptions = (pads.data?.sets ?? []).map(set => set.key);

    /**
     * Closing, or asking first.
     *
     * The three ways out of this sheet — Escape, the scrim and Cancel — all used to drop whatever was
     * in the fields without a word, which on a nineteen-field character sheet is the most expensive
     * thing this component can do and the only one with no undo. It asks only when there is something
     * to lose: a sheet opened and read is closed by pressing Escape, and a dialog in the way of that
     * is a dialog nobody reads by the third time.
     *
     * `isDirty` covers a generated draft too, which is right — the model's answer is unsaved work in
     * exactly the way a typed one is.
     */
    const requestClose = () => {
        if (form.isDirty()) setDiscarding(true);
        else onClose();
    };

    const discard = () => {
        setDiscarding(false);
        onClose();
    };

    /**
     * Where the save went wrong, put back on screen.
     *
     * The three validated fields are the first three in the sheet and Save is pinned to the footer,
     * so pressing it from the bottom set an error on a field sixteen boxes above the viewport and
     * looked, from where the operator was standing, like a button that does nothing.
     *
     * The field is found through `getInputNode` rather than by hunting the DOM for `aria-invalid`.
     * This runs from Mantine's own validation-failure callback, which is BEFORE React has committed
     * the errors it just set — so at that moment nothing in the sheet is marked invalid yet, and the
     * query found nothing every time. Asking the form for the node needs no render to have happened.
     *
     * `VALIDATED` rather than the errors object's own key order, because that follows the order the
     * rules were declared in and the operator is looking at the order the fields are drawn in.
     */
    const showFirstFault = (errors: Record<string, unknown>) => {
        const first = VALIDATED.find(field => errors[field] !== undefined);
        if (first === undefined) return;

        const node = form.getInputNode(first);
        node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        node?.focus({ preventScroll: true });
    };

    return (
        /* A character sheet is fourteen fields and is read whole, which is why this is one scroll
           rather than tabs: a field behind a tab is a field an author does not know is there. What
           that costs without help is the Save button, which sits under the fourteenth field and is
           therefore off screen for the whole of the editing. So the FIELDS scroll and the footer
           does not.

           A right-hand sheet rather than a centred modal. The fields are a tall column and a modal
           made them a tall column in the middle of a dimmed page, with the roster behind it doing
           nothing; anchored to the edge, the sheet is as tall as the window by default and the list
           it was opened from stays where it was. Inline rather than in `theme.components` because
           this is the one sheet long enough to need it; the day a second one is, it moves. */
        <Drawer
            opened={opened}
            onClose={requestClose}
            title={titleFor(persona, kind, t)}
            position="right"
            size={phone ? '100%' : 620}
            styles={{
                content: { display: 'flex', flexDirection: 'column' },
                // `minHeight: 0` is what actually makes the scroll happen: a flex child's default
                // floor is its content, so without it the body grows past the content's max height
                // instead of overflowing inside it.
                body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
            }}
        >
            <form
                onSubmit={form.onSubmit(values => onSubmit(draftOf(values)), showFirstFault)}
                style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
            >
                <Stack gap="md" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} pr="xs">
                    {persona === undefined ? (
                        <Card padding="sm">
                            <Stack gap="xs">
                                <Eyebrow>{t('editor.generate.eyebrow')}</Eyebrow>
                                <Textarea
                                    aria-label={t('editor.generate.eyebrow')}
                                    placeholder={
                                        hosting
                                            ? t('editor.generate.placeholderHost')
                                            : guest
                                              ? t('editor.generate.placeholderGuest')
                                              : t('editor.generate.placeholderCaller')
                                    }
                                    description={t('editor.generate.description')}
                                    autosize
                                    minRows={2}
                                    maxRows={8}
                                    value={description}
                                    onChange={event => setDescription(event.currentTarget.value)}
                                />
                                {/* Truthiness rather than `=== undefined`: a mutation that has never
                                    failed carries `error: null`, so an identity check against
                                    undefined renders the alert on every success. */}
                                {generate.error ? (
                                    <ErrorAlert
                                        title={t('editor.generate.errorTitle')}
                                        error={generate.error}
                                        fallback={t('editor.generate.errorFallback')}
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
                                                onSuccess: written => {
                                                    // The model names the character, so its key is
                                                    // its own and the name no longer drives it.
                                                    setOwnKey(true);
                                                    // What the character does is the operator's, as
                                                    // the button they pressed said, and not the model's.
                                                    form.setValues({ ...valuesOf(written.persona, kind), kinds: form.values.kinds });
                                                },
                                            })
                                        }
                                    >
                                        {t('editor.generate.button')}
                                    </Button>
                                </Group>
                            </Stack>
                        </Card>
                    ) : undefined}

                    <PersonaEditorWho
                        form={form}
                        persona={persona}
                        ownKey={ownKey}
                        setOwnKey={setOwnKey}
                        hosting={hosting}
                        guest={guest}
                        appears={appears}
                        newsreader={newsreader}
                        hostOptions={hostOptions}
                        hostLabel={hostLabel}
                    />

                    <PersonaEditorTalk form={form} hosting={hosting} />

                    <PersonaEditorDials form={form} voiceOptions={voiceOptions} boardOptions={boardOptions} preview={preview} />
                </Stack>

                {/* Outside the scroll, so the way out of this form is never fourteen fields away.
                    The standing-rules sentence comes with it rather than staying at the bottom of
                    the fields: it is about what SAVING does, so it belongs beside the button that
                    does it. */}
                <Stack gap="sm" pt="md" mt="md" style={{ borderTop: '1px solid var(--da-border)' }}>
                    {/* Beside the button that caused it, on the same rule the standing-rules sentence
                        below follows. It was at the top of the fields, which is sixteen boxes above
                        where an operator is standing when they press Save — and a taken key is
                        reported exactly there, so the one save that fails for a reason worth reading
                        was the one that looked like a button doing nothing. */}
                    {error === undefined ? undefined : (
                        <ErrorAlert title={t('editor.saveError.title')} error={error} fallback={t('editor.saveError.fallback')} />
                    )}

                    {/* The rehearsal is pinned to the footer so the effect of an edit is audible from
                        where it is made, rather than from a button on a card behind this sheet.

                        It rehearses what is SAVED, and says so. The API's rehearsal takes a persona
                        id and reads the stored row — there is no endpoint that would speak a draft —
                        so a button here claiming to include unsaved edits would be the sheet lying
                        about what an operator is hearing. Offered only on a character that exists,
                        because a new one has no row to read. */}
                    {persona ? (
                        <Group gap="sm" wrap="nowrap" align="center">
                            <Button
                                variant="default"
                                size="compact-sm"
                                loading={rehearse.isPending}
                                onClick={() => rehearse.mutate(persona.id)}
                                style={{ flexShrink: 0 }}
                            >
                                {t('editor.rehearse.button')}
                            </Button>
                            <Text size="xs" c="dimmed">
                                {t('editor.rehearse.note')}
                            </Text>
                        </Group>
                    ) : undefined}

                    {rehearse.error ? (
                        <ErrorAlert title={t('editor.rehearse.errorTitle')} error={rehearse.error} fallback={t('editor.rehearse.errorFallback')} />
                    ) : undefined}

                    {rehearse.data ? (
                        <PersonaRehearsalPanel rehearsal={rehearse.data} {...(persona?.voice === undefined ? {} : { voice: persona.voice })} />
                    ) : undefined}

                    <Group justify="space-between" align="flex-end" wrap="nowrap">
                        <Text c="dimmed" size="xs">
                            {t('editor.rules')}
                        </Text>
                        <Group wrap="nowrap">
                            <Button variant="subtle" onClick={requestClose}>
                                {t('action.cancel', { ns: 'common' })}
                            </Button>
                            <Button type="submit" loading={saving}>
                                {t('shared.save')}
                            </Button>
                        </Group>
                    </Group>
                </Stack>
            </form>

            {/* Inside the drawer rather than beside it, so it is drawn above the sheet it is asking
                about rather than behind it. What it is asking is the one question this component
                cannot answer on the operator's behalf: nineteen fields of writing has no undo, and
                Escape is one keystroke. */}
            <ConfirmModal
                opened={discarding}
                onClose={() => setDiscarding(false)}
                onConfirm={discard}
                title={persona === undefined ? t('editor.discard.titleNew') : t('editor.discard.titleEdit', { label: persona.label })}
                confirmLabel={t('editor.discard.confirm')}
            >
                {persona === undefined ? t('editor.discard.bodyNew') : t('editor.discard.bodyEdit')}
            </ConfirmModal>
        </Drawer>
    );
}

interface Props {
    /** The persona being edited, or absent for a new one. */
    persona?: Persona;
    /**
     * What this character is for.
     *
     * Passed in rather than read off {@link Props.persona}, because a NEW one has no row to read it
     * from and the page already knows which button was pressed.
     */
    kind: PersonaKind;
    opened: boolean;
    onClose: () => void;
    onSubmit: (draft: PersonaInput) => void;
    saving: boolean;
    error?: unknown;
}
