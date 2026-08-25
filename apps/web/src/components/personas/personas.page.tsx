import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Card, CloseButton, Group, Stack, Text, TextInput } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { Persona, PersonaInput, ScriptHistorySummaryRow, Voice } from '@deadair/sdk';

import {
    useCreatePersona,
    useDeletePersona,
    usePersonas,
    usePutPersonaOnAir,
    useRehearsePersona,
    useRestorePersonas,
    useUpdatePersona,
} from '../../api/personas.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { SUMMARY_HOURS, useScriptSummary } from '../../api/scripts.queries';
import { fetchVoiceSample, useVoices } from '../../api/voices.queries';
import { useVoicePreview } from '../voices/voice.preview';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { toneColor } from '../shared/status';
import { PersonaDeleteModal } from './persona.delete.modal';
import { PersonaEditor } from './persona.editor';
import { PersonaNotesPanel } from './persona.notes';
import { PersonaStoriesPanel } from './persona.stories';
import { PersonaRehearsalPanel } from './persona.rehearsal';
import { PresentingBanner } from './presenting.banner';

/**
 * Who the station is when it opens its mouth.
 *
 * One persona is on air at a time, and putting one there changes four things at once: what the
 * model is told to sound like, what the station says when the model declines, which voice speaks it,
 * and what it programmes towards. That is the reason this is a page rather than four settings — a
 * character is one decision.
 *
 * A change is heard on the NEXT break rather than immediately, and the page says so. Breaks are
 * written a little ahead of their slot, so whatever is already rendered airs in the character it
 * was written in; nothing here can reach into audio that already exists.
 */
export function PersonasPage() {
    const personas = usePersonas();
    const create = useCreatePersona();
    const update = useUpdatePersona();
    const remove = useDeletePersona();
    const putOnAir = usePutPersonaOnAir();
    const restore = useRestorePersonas();
    const rehearse = useRehearsePersona();
    // What the keys on these cards actually sound like, and one player shared by all of them.
    const voices = useVoices(true);
    const preview = useVoicePreview();
    // How each of them is doing on air. One call for the whole roster, since the question is asked
    // about a list and a card each would open this page with nineteen requests.
    const summary = useScriptSummary();

    // `undefined` is closed; a persona is editing that one; `null` is a new one. The one place in
    // this app where null earns its keep: "no editor" and "an editor with nothing in it" are
    // genuinely different states.
    const [editing, setEditing] = useState<Persona | null | undefined>(undefined);
    // Which character's notebook is open, or none. One at a time, because the panel fetches per
    // persona and a page of nineteen open notebooks is nineteen requests nobody asked for.
    const [notebook, setNotebook] = useState<string | undefined>(undefined);
    // Its own toggle rather than a second tab inside the notebook's, because they are two different
    // questions about a character: what it has picked up from its own broadcasts, and what happened
    // to it before any of them. One open panel each, for the reason the notebook has one.
    const [shelf, setShelf] = useState<string | undefined>(undefined);
    // Which character a delete is being asked about. Holding the persona rather than its id, so the
    // dialog can name what it is about to take without looking it back up.
    const [deleting, setDeleting] = useState<Persona | undefined>(undefined);
    // A sieve over a list already in hand, so it is state rather than a search param and there is
    // nothing to debounce: no request rides it, and a URL naming a filter over a client-side list
    // would be a link to somebody else's half-typed word.
    const [filter, setFilter] = useState('');

    const close = () => {
        setEditing(undefined);
        create.reset();
        update.reset();
    };

    const closeDelete = () => {
        setDeleting(undefined);
        remove.reset();
    };

    const submit = (draft: PersonaInput) => {
        const done = { onSuccess: close };
        if (editing === null) create.mutate(draft, done);
        else if (editing !== undefined) update.mutate({ id: editing.id, body: draft }, done);
    };

    const all = personas.data?.personas ?? [];
    const shown = matching(ordered(all), filter);

    return (
        <Stack gap="lg">
            <PageHeader
                title="Personas"
                description={
                    <Text c="dimmed" size="sm">
                        Who the station is when it talks. The one on air decides how a break is written, what it says when nothing wrote it, which
                        voice reads it, and what the station programmes towards. A change is heard on the next break.
                    </Text>
                }
                actions={
                    <>
                        {/* Safe to press twice: it writes only what is missing, overwrites nothing an
                            operator has rewritten, and puts nothing on air. That is what keeps it a
                            plain button rather than something behind a confirmation. */}
                        <Button variant="default" loading={restore.isPending} onClick={() => restore.mutate(undefined)}>
                            Restore built-ins
                        </Button>
                        <Button onClick={() => setEditing(null)}>New persona</Button>
                    </>
                }
            />

            {personas.error ? (
                <ErrorAlert title="Personas could not be loaded" error={personas.error} fallback="The persona list is unavailable." />
            ) : undefined}

            {/* Draws itself only when the show on air named a host of its own, which is the one
                state where the "On air" badge below is not who is speaking. */}
            <PresentingBanner />

            {/* The one failure that stays page-level, because the button that asks for it is up
                here and it is about the list rather than about any row in it. Putting one on air,
                rehearsing one and deleting one all report on the card that asked. */}
            {restore.error ? (
                <ErrorAlert title="The station personas could not be restored" error={restore.error} fallback="Nothing was written." />
            ) : undefined}

            {personas.isPending ? (
                <Stack gap="sm">
                    <PageSkeleton variant="card" />
                    <PageSkeleton variant="card" />
                </Stack>
            ) : undefined}

            {personas.data?.personas.length === 0 ? (
                <EmptyState>
                    This station has no personas, which is an ordinary state rather than a fault: it writes its breaks from the station&apos;s own
                    phrasings and speaks them in the plugin&apos;s default voice. Write one to give it a character.
                </EmptyState>
            ) : undefined}

            {/* Only once the roster is long enough to be worth sieving. A search box over six cards
                is a control that costs more attention than it saves. */}
            {all.length > FILTER_FROM ? (
                <TextInput
                    value={filter}
                    onChange={event => setFilter(event.currentTarget.value)}
                    placeholder="Find a character"
                    aria-label="Find a character"
                    maw={360}
                    rightSection={
                        filter.length > 0 ? <CloseButton size="sm" onClick={() => setFilter('')} aria-label="Clear the filter" /> : undefined
                    }
                />
            ) : undefined}

            {all.length > 0 && shown.length === 0 ? (
                <EmptyState>No character here matches that. Clear the box to see the whole roster again.</EmptyState>
            ) : undefined}

            <Stack gap="sm">
                {shown.map(persona => (
                    <Card key={persona.id}>
                        <Group justify="space-between" align="flex-start" wrap="nowrap">
                            <Stack gap="xxs" style={{ minWidth: 0 }}>
                                <Group gap="xs">
                                    <Text fw={600}>{persona.label}</Text>
                                    {persona.active ? (
                                        <Badge color="green" variant="light">
                                            On air
                                        </Badge>
                                    ) : undefined}
                                    {persona.djName ? (
                                        <Badge variant="outline" color="gray">
                                            {persona.djName}
                                        </Badge>
                                    ) : undefined}
                                </Group>
                                <Text size="sm" c="dimmed">
                                    {persona.style}
                                </Text>
                                <PersonaSummary persona={persona} />

                                {persona.voice ? (
                                    <Group gap="xxs" wrap="nowrap">
                                        <Text size="xs" c="dimmed">
                                            {/* Both halves: the slot is what the editor and the
                                                voices page call it, and what it maps to is the only
                                                part saying anything about the sound. A station with
                                                no speech plugin gets the slot alone, which is all
                                                anything knows then. */}
                                            speaks as {describeVoice(persona.voice, voices.data?.voices)}
                                        </Text>
                                        <ActionIcon
                                            variant="subtle"
                                            size="xs"
                                            loading={preview.isLoading(persona.voice)}
                                            aria-label={`Play a sample of the voice ${persona.label} speaks in`}
                                            onClick={() =>
                                                preview.play(
                                                    persona.voice!,
                                                    () => fetchVoiceSample(persona.voice!),
                                                    'That voice could not be previewed.',
                                                )
                                            }
                                        >
                                            {preview.isPlaying(persona.voice) ? '❚❚' : '▶'}
                                        </ActionIcon>
                                    </Group>
                                ) : undefined}

                                <PersonaRecord counts={countsFor(persona.key, summary.data?.rows)} />

                                {/* In the card's own column rather than the row of buttons, because
                                    it goes somewhere rather than doing something — and because six
                                    actions in that row is one more than fits. Keyed on the
                                    persona's KEY rather than its id, since that is what
                                    `script_history` stamps: the rows outlive the character, so what
                                    it said survives it being deleted. */}
                                <Anchor
                                    size="xs"
                                    renderRoot={props => <Link to="/scripts" search={{ segment: '', persona: persona.key }} {...props} />}
                                >
                                    What they&apos;ve said
                                </Anchor>

                                {persona.voice && preview.failureFor(persona.voice) ? (
                                    <Text size="xs" c="red.4">
                                        {preview.failureFor(persona.voice)}
                                    </Text>
                                ) : undefined}
                            </Stack>
                            <Group gap="xs" wrap="nowrap">
                                {persona.active ? undefined : (
                                    <Button
                                        variant="light"
                                        size="compact-sm"
                                        loading={putOnAir.isPending && putOnAir.variables === persona.id}
                                        onClick={() => putOnAir.mutate(persona.id)}
                                    >
                                        Put on air
                                    </Button>
                                )}
                                {/* Spends a generation and changes nothing, so it is a plain button
                                    rather than something behind a confirmation — but it takes the
                                    one model slot, which is why only one runs at a time. */}
                                <Button
                                    variant="subtle"
                                    size="compact-sm"
                                    loading={rehearse.isPending && rehearse.variables === persona.id}
                                    disabled={rehearse.isPending}
                                    onClick={() => rehearse.mutate(persona.id)}
                                >
                                    Rehearse
                                </Button>
                                {/* One at a time: the panel fetches per character, and every open
                                    notebook is a request nobody asked for. */}
                                <Button
                                    variant="subtle"
                                    size="compact-sm"
                                    onClick={() => setNotebook(current => (current === persona.id ? undefined : persona.id))}
                                >
                                    {notebook === persona.id ? 'Hide notebook' : 'Notebook'}
                                </Button>
                                <Button
                                    variant="subtle"
                                    size="compact-sm"
                                    onClick={() => setShelf(current => (current === persona.id ? undefined : persona.id))}
                                >
                                    {shelf === persona.id ? 'Hide stories' : 'Stories'}
                                </Button>
                                <Button variant="subtle" size="compact-sm" onClick={() => setEditing(persona)}>
                                    Edit
                                </Button>
                                {/* The one action here that loses something an operator wrote, so
                                    it is the one that asks first and says what goes with it. */}
                                <Button
                                    variant="subtle"
                                    color="red"
                                    size="compact-sm"
                                    loading={remove.isPending && remove.variables === persona.id}
                                    onClick={() => setDeleting(persona)}
                                >
                                    Delete
                                </Button>
                            </Group>
                        </Group>

                        {/* Each failure belongs to the button that asked for it. A page-level alert
                            for a per-card button puts the reason at the top of a list of fourteen,
                            where an operator working on the ninth will not see it. */}
                        {putOnAir.error && putOnAir.variables === persona.id ? (
                            <CardFailure error={putOnAir.error} fallback="The station is still in the character it was." />
                        ) : undefined}

                        {rehearse.error && rehearse.variables === persona.id ? (
                            <CardFailure error={rehearse.error} fallback="Nothing was changed: a rehearsal writes no row and cannot air." />
                        ) : undefined}

                        {/* Keyed on the persona it was actually run for rather than simply rendered
                            under whichever card is last: one result is held at a time, and a panel
                            that stayed put while a different persona was rehearsed would attribute
                            one character's words to another. */}
                        {rehearse.data?.personaId === persona.id ? (
                            <PersonaRehearsalPanel rehearsal={rehearse.data} {...(persona.voice === undefined ? {} : { voice: persona.voice })} />
                        ) : undefined}

                        {notebook === persona.id ? <PersonaNotesPanel personaId={persona.id} /> : undefined}

                        {shelf === persona.id ? <PersonaStoriesPanel personaId={persona.id} /> : undefined}
                    </Card>
                ))}
            </Stack>

            <PersonaEditor
                // Keyed, so opening a different persona builds a fresh form rather than showing the
                // last one's values under the new one's title.
                key={editing === null ? 'new' : (editing?.id ?? 'closed')}
                {...(editing === null || editing === undefined ? {} : { persona: editing })}
                opened={editing !== undefined}
                onClose={close}
                onSubmit={submit}
                saving={create.isPending || update.isPending}
                error={create.error ?? update.error ?? undefined}
            />

            <PersonaDeleteModal
                {...(deleting === undefined ? {} : { persona: deleting })}
                opened={deleting !== undefined}
                onClose={closeDelete}
                // Closed only once it worked: a delete that failed leaves the dialog up holding the
                // reason, where a dialog that closed anyway would report a loss that did not happen.
                onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: closeDelete })}
                deleting={remove.isPending}
                error={remove.error ?? undefined}
            />
        </Stack>
    );
}

/** This character's attempts in the window, or nothing when it has made none. */
function countsFor(key: string, rows: ScriptHistorySummaryRow[] | undefined): ScriptHistorySummaryRow | undefined {
    return rows?.find(row => row.personaKey === key);
}

/**
 * How a character is doing on air, which is the one thing about it no sheet can say.
 *
 * A decline is drawn in the same dimmed text as everything else, deliberately: it is the writer
 * registry working, and painting it as a fault would teach an operator to go looking for a break
 * that was covered for exactly as designed. What IS worth a colour is `failed`, where something
 * threw — and only when there is one, so a healthy character carries no red at all.
 *
 * A character with no attempts says nothing rather than "0 written". It has not been on air lately,
 * which the row's own absence already says, and three zeroes read as a fault that has not happened.
 */
function PersonaRecord({ counts }: { counts?: ScriptHistorySummaryRow }) {
    if (counts === undefined) return undefined;

    return (
        <Group gap="xxs" wrap="nowrap">
            <Text size="xs" c="dimmed" className="da-num">
                {counts.written} written · {counts.declined} declined
            </Text>
            {counts.failed > 0 ? (
                <Text size="xs" c={toneColor.fault} className="da-num">
                    · {counts.failed} failed
                </Text>
            ) : undefined}
            <Text size="xs" c="dimmed">
                in {SUMMARY_HOURS}h
            </Text>
        </Group>
    );
}

/** What a character is missing, or nothing at all when it is missing nothing. */
function PersonaSummary({ persona }: { persona: Persona }) {
    const summary = summarise(persona);
    if (summary === undefined) return undefined;

    return (
        <Text size="xs" c="dimmed">
            {summary}
        </Text>
    );
}

/** One card's own bad news, in the place the button that caused it is. */
function CardFailure({ error, fallback }: { error: unknown; fallback: string }) {
    return (
        <Text size="xs" c="red.4" mt="xs" ta="right">
            {apiErrorMessage(error, fallback)}
        </Text>
    );
}

/**
 * A voice as something an operator can hear in their head, or as the word they typed.
 *
 * The station voice id is a name this station chose and the engine has never heard of, so on its own
 * it says nothing about the sound. The plugin's description is what does — and it is absent exactly
 * when nothing can speak, which is when the key is all there is.
 */
function describeVoice(voiceId: string, voices: Voice[] | undefined): string {
    const voice = voices?.find(candidate => candidate.id === voiceId);
    return voice?.description === undefined ? voiceId : `${voiceId}, ${voice.description}`;
}

/** Below this many characters, a filter box is a control that costs more attention than it saves. */
const FILTER_FROM = 6;

/**
 * The roster, with whoever the station falls back to at the top.
 *
 * Server order otherwise, and a stable sort, because the order personas were written in is the only
 * other thing an operator has to find one by. The station's own host being fourteen cards down was
 * the list saying nothing about which card matters.
 */
function ordered(personas: Persona[]): Persona[] {
    return [...personas].sort((left, right) => Number(right.active) - Number(left.active));
}

/** Everything a character can be looked up by: what it is called, what it is, and who it says it is. */
function matching(personas: Persona[], filter: string): Persona[] {
    const term = filter.trim().toLowerCase();
    if (term.length === 0) return personas;

    return personas.filter(persona =>
        [persona.label, persona.key, persona.style, persona.djName ?? ''].some(field => field.toLowerCase().includes(term)),
    );
}

/**
 * The one line under a persona, which says something only when there is something to say.
 *
 * It used to state three facts about every character — its phrasings, its markers, its voice —
 * which on a roster of seeds is the same sentence fourteen times over, and a line that reads
 * identically on every card is a line nobody reads on any of them. So each half is now printed only
 * when it DEVIATES from a character that is fully equipped, and a card with nothing wrong carries no
 * summary at all.
 *
 * All three deviations are ordinary states rather than faults, which is why this is dimmed text and
 * not a warning: a character with no phrasings of its own still gets the station's, and one with no
 * markers is simply not checked. What they have in common is that each is a thing an operator
 * would otherwise discover by putting the character on air.
 */
function summarise(persona: Persona): string | undefined {
    const parts: string[] = [];

    const phrasings = (persona.templates ?? '').split('\n').filter(line => line.trim().length > 0).length;
    if (phrasings === 0) parts.push("no phrasings of its own, so it falls back to the station's when the model declines");

    if ((persona.dictionMarkers?.length ?? 0) === 0) parts.push('not checked for staying in character');

    if (!persona.voice) parts.push("speaks in the plugin's default voice");

    return parts.length === 0 ? undefined : parts.join(' · ');
}
