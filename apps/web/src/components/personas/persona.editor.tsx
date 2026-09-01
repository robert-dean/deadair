import { useState } from 'react';
import {
    ActionIcon,
    Autocomplete,
    Button,
    Card,
    Code,
    Divider,
    Drawer,
    Group,
    Select,
    SimpleGrid,
    Stack,
    Text,
    TextInput,
    Textarea,
} from '@mantine/core';
import type { SelectProps } from '@mantine/core';
import { IconDice5, IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import { useForm } from '@mantine/form';
import type { Persona, PersonaDraftView, PersonaInput } from '@deadair/sdk';

/** What a character is for. Mirrors the API's own enum; absent there means `host`. */
type PersonaKind = NonNullable<PersonaInput['kind']>;

import { useGeneratePersona, useRehearsePersona } from '../../api/personas.queries';
import { usePads } from '../../api/pads.queries';
import { usePhone } from '../shared/use.phone';
import { fetchVoiceSample, useVoices } from '../../api/voices.queries';
import { useVoicePreview } from '../voices/voice.preview';
import { suggestAirName } from './air.names';
import { personaKeyFor } from './persona.key';
import { PersonaRehearsalPanel } from './persona.rehearsal';
import { faultInTemplate, templateLines } from './template.vocabulary';
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
    // Fixed for the life of the form rather than a field. What a character is FOR decides which
    // half of the roster it lands in and whether it can ever present, and flipping it under a
    // character an operator has already cast would be a quieter change than it looks.
    const caller = kind === 'caller';
    const voices = useVoices(opened);
    const pads = usePads();
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
            title={titleFor(persona, caller)}
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
                onSubmit={form.onSubmit(values => onSubmit(draftOf(values, kind)), showFirstFault)}
                style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
            >
                <Stack gap="md" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} pr="xs">
                    {persona === undefined ? (
                        <Card withBorder padding="sm">
                            <Stack gap="xs">
                                <Eyebrow>Start from a description</Eyebrow>
                                <Textarea
                                    placeholder={
                                        caller
                                            ? 'a taxi driver who rings in every week to argue about the charts'
                                            : 'a 1970s northern soul DJ who broadcasts from the back of a chip shop'
                                    }
                                    description="Fills in the fields below. Nothing is saved until you press Save, and you can change any of it first."
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
                                                onSuccess: written => {
                                                    // The model names the character, so its key is
                                                    // its own and the name no longer drives it.
                                                    setOwnKey(true);
                                                    form.setValues(valuesOf(written.persona));
                                                },
                                            })
                                        }
                                    >
                                        Write me one
                                    </Button>
                                </Group>
                            </Stack>
                        </Card>
                    ) : undefined}

                    <Section title="Who they are" blurb='The half of a character the model is told about. Everything here completes "You are …".' />

                    {/* Both halves carry a description, which is not padding: one field had one and
                        the other did not, so the two inputs sat eighteen pixels apart on a row that
                        is meant to read as one. */}
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <TextInput
                            label="Name"
                            description="What the roster calls them."
                            placeholder="Late-night companion"
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
                            label="Key"
                            description={
                                ownKey
                                    ? 'A short slug, unique to this station.'
                                    : 'A short slug, unique to this station. Follows the name until you write your own.'
                            }
                            {...form.getInputProps('key')}
                            onChange={event => {
                                setOwnKey(true);
                                form.setFieldValue('key', event.currentTarget.value);
                            }}
                        />
                    </SimpleGrid>

                    <Textarea
                        label="Who they are"
                        description='Completes "You are …". Who they ARE; how they talk is below.'
                        placeholder="a quiet late-night host sitting close to the mic"
                        autosize
                        minRows={2}
                        maxRows={8}
                        {...form.getInputProps('style')}
                    />

                    <TextInput
                        label="On-air name"
                        description="Overrides the station's presenter name while this persona is on air. Leave empty to keep it."
                        {...form.getInputProps('djName')}
                        // Inside the field rather than beside it, so the suggestion lands where the
                        // operator is already looking. A button rather than a pre-filled value:
                        // empty means "keep the station's name", which is a real answer and not one
                        // a suggestion may quietly overwrite.
                        rightSection={
                            <ActionIcon
                                variant="subtle"
                                color="gray"
                                aria-label="Suggest an on-air name"
                                title="Suggest an on-air name"
                                onClick={() => {
                                    form.setFieldValue('djName', suggestAirName(form.getValues().djName));
                                }}
                            >
                                <IconDice5 size={16} stroke={1.8} />
                            </ActionIcon>
                        }
                    />

                    <Textarea
                        label="True about them"
                        description="A couple of grounded facts they may mention about themselves."
                        autosize
                        minRows={2}
                        maxRows={8}
                        {...form.getInputProps('background')}
                    />

                    <Section
                        title="How they talk"
                        blurb="The dialect, and the words that prove a break came back in character. A break carrying none of them is rewritten from the phrasings below."
                    />

                    <Textarea
                        label="How they speak"
                        description="The dialect, one rule per line. This applies to EVERY sentence, including the ones stating a plain fact."
                        placeholder={'Always contract: "you\'re", "that\'s"\nSpeak to one person, not a crowd'}
                        autosize
                        minRows={5}
                        maxRows={14}
                        {...form.getInputProps('diction')}
                    />

                    <Textarea
                        label="Words that prove it"
                        description="One per line. A break that comes back carrying none of these is treated as out of character and the phrasings below write it instead. An entry ending in an apostrophe matches as a suffix, so in' catches every dropped g. Leave empty to check nothing."
                        placeholder={"ye\naye\nmatey\nin'"}
                        autosize
                        minRows={4}
                        maxRows={12}
                        {...form.getInputProps('dictionMarkers')}
                    />

                    <Textarea
                        label="In character"
                        description="What they always and never do on air, one per line."
                        autosize
                        minRows={4}
                        maxRows={12}
                        {...form.getInputProps('quirks')}
                    />

                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <Textarea
                            label="Signature phrases"
                            description="One per line. Asked for sparingly: at most one, and not every break."
                            autosize
                            minRows={3}
                            maxRows={10}
                            {...form.getInputProps('catchphrases')}
                        />
                        <Textarea label="Never say" description="One per line." autosize minRows={3} maxRows={10} {...form.getInputProps('avoid')} />
                    </SimpleGrid>

                    {/* A caller has no floor and should not have one: phrasings are what the STATION
                        says when the model declines, and a phone-in whose caller was written by a
                        template is a phone-in with nobody on the phone. So the section is not drawn
                        rather than drawn and ignored. */}
                    {caller ? undefined : (
                        <>
                            <Section
                                title="What they fall back on"
                                blurb="Most breaks are not written by a model. These are the words the station uses when it declines — a character with none falls back to plain English."
                            />

                            <Textarea
                                label="Their own phrasings"
                                description="One per line, in the same syntax as the station's break phrasings. These are what the station says when the model declines, which is most breaks — so a character with none falls back to plain English."
                                placeholder="That was {{previous.title}}, from {{previous.artist}}.[[ Next up, {{next.title}}.]]"
                                autosize
                                minRows={6}
                                maxRows={16}
                                {...form.getInputProps('templates')}
                            />

                            <TemplateFaults raw={form.values.templates} />
                        </>
                    )}

                    <Textarea
                        label="Lines in their voice"
                        description="One per line. Used as examples for the model, which is asked to reuse the grammar and never the sentences."
                        autosize
                        minRows={3}
                        maxRows={10}
                        {...form.getInputProps('samples')}
                    />

                    <Section
                        title="How far they go"
                        blurb="Dials with real consequences on air. They change what the station ASKS its presenter for — how long a break is, how much room it gets, and how often one happens. None of them can loosen what the station always sends: every refusal, and your explicit-content setting, hold whatever is set here."
                    />

                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        {voiceOptions.length > 0 ? (
                            <Select
                                label="Voice"
                                description="Leave empty for whatever the speech plugin uses by default."
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
                                            aria-label="Play a sample of this voice"
                                            onClick={() =>
                                                preview.play(
                                                    form.values.voice,
                                                    () => fetchVoiceSample(form.values.voice),
                                                    'That voice could not be previewed.',
                                                )
                                            }
                                        >
                                            {preview.isPlaying(form.values.voice) ? (
                                                <IconPlayerPauseFilled size={14} />
                                            ) : (
                                                <IconPlayerPlayFilled size={14} />
                                            )}
                                        </ActionIcon>
                                    ) : undefined
                                }
                                {...form.getInputProps('voice')}
                            />
                        ) : (
                            <TextInput
                                label="Voice"
                                description="No speech plugin is answering, so this is the id as your engine will map it."
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
                            label="Soundboard"
                            description="The set of sounds this character can reach for. Leave empty for a presenter who works without one."
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
                            label="How much they say"
                            description="Only shorter than the station's usual, because the length of a break is set by where the model stops rather than by the ceiling. It asks for less; nothing refuses a break for running past it."
                            data={[
                                { value: '', label: "The station's usual" },
                                { value: 'short', label: 'Says less — a sentence or two' },
                                { value: 'one-line', label: 'Says almost nothing — one line' },
                            ]}
                            {...form.getInputProps('brevity')}
                        />

                        <Select
                            {...DIAL}
                            label="How much rope they get"
                            description="Room to follow a thought instead of making one point, with a longer break to do it in. On links, welcomes and the character's own stories, never the news or the weather. The station's explicit-content setting still outranks it, and a break that names neither record or drops the character is still refused."
                            data={[
                                { value: '', label: "The station's usual discipline" },
                                { value: 'loose', label: 'Room — follows a thought where it goes' },
                                { value: 'unleashed', label: 'Off the leash — and says it however they like' },
                            ]}
                            {...form.getInputProps('latitude')}
                        />

                        <Select
                            {...DIAL}
                            label="How often they bring up their own past"
                            description="Their stories are kept on this character's own shelf, and at most one ever reaches a break. This is only about ordinary talk breaks: a story band on your clock asks for one whatever this says."
                            data={[
                                { value: '', label: 'Occasionally — when nothing is known about the records' },
                                { value: 'often', label: 'Often — most breaks' },
                                { value: 'never', label: 'Never in a link' },
                            ]}
                            {...form.getInputProps('storytelling')}
                        />

                        <Select
                            {...DIAL}
                            label="How often they talk"
                            description="Scales the gap your station leaves between its own breaks. It does not touch anything on your clock: a band asking for news at nine is you asking in as many words. There is no silent setting — turning breaks off is a station setting, and two switches for one thing would disagree."
                            data={[
                                { value: '', label: "Ordinary — the station's own interval" },
                                { value: 'relentless', label: 'Relentless — twice as often' },
                                { value: 'chatty', label: 'Chatty — a little more often' },
                                { value: 'sparing', label: 'Sparing — a little less often' },
                                { value: 'reserved', label: 'Reserved — half as often' },
                            ]}
                            {...form.getInputProps('chattiness')}
                        />
                    </SimpleGrid>

                    {/* The two compose, and neither control can say so on its own: a terse character
                        can be unfiltered, and reading the pair back is the only way an operator sees
                        what they have actually asked for. Each field's own description explains what
                        it does; this says what the combination comes to. */}
                    <Text size="xs" c="dimmed">
                        {voiceReadout(form.values.brevity, form.values.latitude, form.values.storytelling, form.values.chattiness)}
                    </Text>

                    <Textarea
                        label="What they keep coming back to"
                        description="One subject per line. Only ONE of these reaches any break, chosen in turn, so a longer list is more variety rather than more to say at once. These are subjects; the rules about how they behave belong above."
                        placeholder={'the pressing plant\nthe session that booked four hours\nthe running order of this station'}
                        autosize
                        minRows={4}
                        maxRows={12}
                        {...form.getInputProps('preoccupations')}
                    />

                    <UnusedMarkers markers={form.values.dictionMarkers} samples={form.values.samples} />
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
                        <ErrorAlert title="That could not be saved" error={error} fallback="The persona could not be saved." />
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
                                Hear a rehearsal
                            </Button>
                            <Text size="xs" c="dimmed">
                                Speaks this character as it was last SAVED. Save first to hear an edit.
                            </Text>
                        </Group>
                    ) : undefined}

                    {rehearse.error ? (
                        <ErrorAlert title="Nothing was spoken" error={rehearse.error} fallback="The station could not rehearse this character." />
                    ) : undefined}

                    {rehearse.data ? (
                        <PersonaRehearsalPanel rehearsal={rehearse.data} {...(persona?.voice === undefined ? {} : { voice: persona.voice })} />
                    ) : undefined}

                    <Group justify="space-between" align="flex-end" wrap="nowrap">
                        <Text c="dimmed" size="xs">
                            Nothing here can loosen the rules the station always sends: never name a record it was not given, and be certain or say
                            nothing. Saving is heard on the next break the station writes — one already written or being spoken keeps the words it
                            has.
                        </Text>
                        <Group wrap="nowrap">
                            <Button variant="subtle" onClick={requestClose}>
                                Cancel
                            </Button>
                            <Button type="submit" loading={saving}>
                                Save
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
                title={persona === undefined ? 'Throw this character away?' : `Throw away your changes to ${persona.label}?`}
                confirmLabel="Discard"
            >
                {persona === undefined
                    ? 'Nothing here has been saved, so closing now leaves the station with no such character. Keep writing to come back to it.'
                    : 'Nothing here has been saved. The character stays exactly as it was, and everything you have typed since opening this goes.'}
            </ConfirmModal>
        </Drawer>
    );
}

/**
 * What every dial in "How far they go" has in common.
 *
 * The caveat goes UNDER the control rather than above it. Four of these sit in a grid and their
 * caveats run to three, seven, five and eight lines, so with the description in its usual place the
 * four dropdowns landed at four different heights and the row read as broken rather than as four
 * answers to one question. Moving it below puts every control directly under a one-line label, which
 * lines them up — and it reads better anyway: the question, the answer, then what the answer costs.
 */
const DIAL = {
    // Mantine types this one mutable, so `as const` on the object makes the tuple unassignable.
    inputWrapperOrder: ['label', 'input', 'description', 'error'] as SelectProps['inputWrapperOrder'],
    allowDeselect: false,
} as const;

/**
 * What the two voice settings come to together.
 *
 * They are two fields because they are two kinds of thing — brevity is a habit and latitude is a
 * permission — and they compose, so neither control can describe the result on its own. An operator
 * who has asked for a terse character with no filter should be able to read that back rather than
 * work it out from two dropdowns.
 *
 * It describes the SHAPE and never a word count. The ceilings live in `break.prompt.ts` and move
 * with what gets measured on air, and a number repeated here would be a second claim about them that
 * nothing keeps true.
 */
function voiceReadout(brevity: string, latitude: string, storytelling: string, chattiness: string): string {
    const length =
        brevity === 'one-line'
            ? 'one line'
            : brevity === 'short'
              ? 'a sentence or two'
              : latitude === ''
                ? "the station's usual length"
                : 'as long as it takes';

    const manner =
        latitude === 'unleashed'
            ? 'Says what it likes, however it likes'
            : latitude === 'loose'
              ? 'Follows a thought where it goes'
              : 'Makes one point';

    // The third field is about MATERIAL rather than manner, so it is a sentence of its own rather
    // than another clause: what it changes is whether there is anything of the character's own life
    // in the prompt, which is a different question from how the character talks.
    const stories =
        storytelling === 'never'
            ? ' It keeps its stories to itself in a link.'
            : storytelling === 'often'
              ? ' It works one of its own stories into most breaks.'
              : ' It reaches for one of its own stories when the station knows nothing about the records.';

    // Frequency is the one of the four that is not about a break at all — it is about how many
    // there are — so it leads with "and" rather than joining the sentence about how one sounds.
    const often =
        chattiness === '' || chattiness === 'ordinary'
            ? ''
            : chattiness === 'relentless'
              ? ' It talks twice as often as the station would on its own.'
              : chattiness === 'chatty'
                ? ' It talks a little more often than the station would on its own.'
                : chattiness === 'sparing'
                  ? ' It talks a little less often than the station would on its own.'
                  : ' It talks half as often as the station would on its own.';

    return `${manner}, in ${length}. The station's content rules and its refusals are unchanged either way.${stories}${often}`;
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
        <ErrorAlert tone="warning" title="Some of it was dropped">
            <Stack gap="xxs">
                {generated.droppedMarkers.length === 0 ? undefined : (
                    <Text size="sm">
                        The model called these words its own and then never used them, so they were left out: {generated.droppedMarkers.join(', ')}. A
                        word the character does not actually say would refuse every break it writes.
                    </Text>
                )}
                {generated.droppedTemplates.length === 0 ? undefined : (
                    <Text size="sm">
                        {generated.droppedTemplates.length} phrasing{generated.droppedTemplates.length === 1 ? '' : 's'} named something the station
                        cannot fill in, so {generated.droppedTemplates.length === 1 ? 'it was' : 'they were'} left out.
                    </Text>
                )}
            </Stack>
        </ErrorAlert>
    );
}

/**
 * One heading, so fourteen boxes read as four questions.
 *
 * The blurb is what turns a divider into a question. "How far they go" over four dropdowns is a
 * label; the sentence under it is the thing an operator needs before touching any of them, and it
 * was previously spread across four separate field descriptions that nobody reads in order.
 *
 * **It used to say each dial only ever asks for LESS than the station's own setting, and that stopped
 * being true.** `chattiness` asks for MORE breaks at two of its five rungs, and `latitude` was
 * already asking for more room at both of its. What was actually load-bearing in that sentence is
 * its second half — that none of these loosens a refusal — so that is what it says now, and the
 * direction claim is gone rather than qualified. A blurb that is true of three fields out of four is
 * worse than none: it is the one line an operator reads before deciding they understand the section.
 */
function Section({ title, blurb }: { title: string; blurb: string }) {
    return (
        <Stack gap={2} mt="xs">
            <Divider mb={2} label={<Eyebrow>{title}</Eyebrow>} labelPosition="left" />
            <Text size="xs" c="dimmed">
                {blurb}
            </Text>
        </Stack>
    );
}

/**
 * What the station could not use in the phrasings box, line by line.
 *
 * Advisory and never blocking, deliberately: the API accepts any text, the vocabulary this is
 * checked against is a copy, and a console that refused a save over its own copy would stop working
 * the day the station learns a new placeholder. What it replaces is finding out by watching a
 * character for an evening and wondering why one of its six lines never comes up.
 *
 * The same three checks the generator already makes about a line a MODEL wrote, which is the point:
 * a line an operator typed was the only one nothing looked at.
 */
function TemplateFaults({ raw }: { raw: string }) {
    const faults = templateLines(raw)
        .map(line => ({ line, fault: faultInTemplate(line) }))
        .filter((entry): entry is { line: string; fault: string } => entry.fault !== undefined);

    if (faults.length === 0) return undefined;

    return (
        <ErrorAlert tone="warning" title={`The station would never pick ${faults.length === 1 ? 'one of these' : `${faults.length} of these`}`}>
            <Stack gap="xxs">
                {faults.map(({ line, fault }) => (
                    <Text key={line} size="sm">
                        <Code>{line.length > 80 ? `${line.slice(0, 80)}…` : line}</Code> {fault}.
                    </Text>
                ))}
            </Stack>
        </ErrorAlert>
    );
}

/**
 * Markers the character is never shown saying, which is a weaker claim than a fault.
 *
 * A marker is what `readAnswer` counts to decide a script is in character, and the sample lines are
 * the model's evidence for how to use one — so a marker appearing in none of them is asking a model
 * to produce a word it has only been told about. It is a note rather than a warning because it is
 * frequently fine: an obvious word needs no example, and a sheet with no samples at all is making no
 * claim either way, which is why nothing is said then.
 */
function UnusedMarkers({ markers, samples }: { markers: string; samples: string }) {
    const written = samples.trim().toLowerCase();
    if (written.length === 0) return undefined;

    const unused = markers
        .split('\n')
        .map(line => line.trim())
        .filter(marker => marker.length > 0)
        // Plain substring, which is what a marker ending in an apostrophe wants anyway: the
        // station's own check reads `in'` as a suffix, so finding it inside `talkin'` is a match
        // there and here alike.
        .filter(marker => !written.includes(marker.toLowerCase()));

    if (unused.length === 0) return undefined;

    return (
        <Text size="xs" c="dimmed">
            Nothing in the lines above uses {unused.join(', ')}. A break is refused for carrying none of these words, so it is worth showing the model
            at least one of them in use.
        </Text>
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

/** The form's own shape: every list field is one string, one entry per line. */
interface FormValues {
    key: string;
    label: string;
    style: string;
    djName: string;
    voice: string;
    soundboard: string;
    background: string;
    brevity: string;
    latitude: string;
    chattiness: string;
    storytelling: string;
    templates: string;
    diction: string;
    dictionMarkers: string;
    quirks: string;
    preoccupations: string;
    catchphrases: string;
    avoid: string;
    samples: string;
}

/**
 * The validated fields, in the order the sheet draws them.
 *
 * Not derived from the `validate` object: that is keyed in the order the rules happened to be
 * written, and a save that faults on two of them should land on whichever the operator meets first.
 */
const VALIDATED = ['label', 'key', 'style'] as const;

const linesOf = (values: string[] | undefined): string => (values ?? []).join('\n');

/** What the modal is called: which kind is being written, or which character is being edited. */
const titleFor = (persona: Persona | undefined, caller: boolean): string =>
    persona === undefined ? (caller ? 'New caller' : 'New host') : `Edit ${persona.label}`;

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
        soundboard: persona?.soundboard ?? '',
        background: persona?.background ?? '',
        brevity: persona?.brevity ?? '',
        latitude: persona?.latitude ?? '',
        chattiness: persona?.chattiness ?? '',
        storytelling: persona?.storytelling ?? '',
        templates: persona?.templates ?? '',
        diction: linesOf(persona?.diction),
        dictionMarkers: linesOf(persona?.dictionMarkers),
        quirks: linesOf(persona?.quirks),
        preoccupations: linesOf(persona?.preoccupations),
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
function draftOf(values: FormValues, kind: PersonaKind): PersonaInput {
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
    const latitude: PersonaInput['latitude'] = values.latitude === 'loose' || values.latitude === 'unleashed' ? values.latitude : undefined;
    const storytelling: PersonaInput['storytelling'] =
        values.storytelling === 'never' || values.storytelling === 'often' ? values.storytelling : undefined;
    // `ordinary` is the default and is sent as absent, matching how every other rung on this form
    // treats its middle: a stored value that means "unchanged" is a row saying what a null already says.
    const chattiness: PersonaInput['chattiness'] =
        values.chattiness === 'reserved' || values.chattiness === 'sparing' || values.chattiness === 'chatty' || values.chattiness === 'relentless'
            ? values.chattiness
            : undefined;

    return {
        key: values.key.trim(),
        kind,
        label: values.label.trim(),
        style: values.style.trim(),
        ...omitUndefined({
            djName: text(values.djName),
            voice: text(values.voice),
            soundboard: text(values.soundboard),
            background: text(values.background),
            // '' is the station's usual length, which is an ABSENT field rather than a rung — the
            // same rule the on-air name follows.
            brevity,
            // Same rule: '' is the station's ordinary discipline, which is a field that is not there
            // rather than a rung meaning "no extra room".
            latitude,
            // And again, with one difference worth knowing: the absent value here is the MIDDLE
            // rung rather than the bottom one. `occasionally` is what a character with nothing set
            // does, so it is the one option in the select with no value behind it — a persona that
            // never mentions its own past is a decision and is stored as `never`.
            chattiness,
            storytelling,
            // Not trimmed per line: the phrasings are parsed by the API the same way the station's
            // own setting is, and a blank line between two of them is somebody spacing their list.
            templates: text(values.templates),
            diction: list(values.diction),
            dictionMarkers: list(values.dictionMarkers),
            quirks: list(values.quirks),
            preoccupations: list(values.preoccupations),
            catchphrases: list(values.catchphrases),
            avoid: list(values.avoid),
            samples: list(values.samples),
        }),
    };
}

function omitUndefined<T extends Record<string, unknown>>(values: T): Partial<T> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}
