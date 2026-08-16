import { useState } from 'react';
import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import type { Persona, PersonaInput } from '@deadair/sdk';

import {
    useCreatePersona,
    useDeletePersona,
    usePersonas,
    usePutPersonaOnAir,
    useRehearsePersona,
    useRestorePersonas,
    useUpdatePersona,
} from '../../api/personas.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { PersonaEditor } from './persona.editor';
import { PersonaRehearsalPanel } from './persona.rehearsal';

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

    // `undefined` is closed; a persona is editing that one; `null` is a new one. The one place in
    // this app where null earns its keep: "no editor" and "an editor with nothing in it" are
    // genuinely different states.
    const [editing, setEditing] = useState<Persona | null | undefined>(undefined);

    const close = () => {
        setEditing(undefined);
        create.reset();
        update.reset();
    };

    const submit = (draft: PersonaInput) => {
        const done = { onSuccess: close };
        if (editing === null) create.mutate(draft, done);
        else if (editing !== undefined) update.mutate({ id: editing.id, body: draft }, done);
    };

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

            {putOnAir.error ? (
                <ErrorAlert
                    title="That persona could not be put on air"
                    error={putOnAir.error}
                    fallback="The station is still in the character it was."
                />
            ) : undefined}

            {restore.error ? (
                <ErrorAlert title="The station personas could not be restored" error={restore.error} fallback="Nothing was written." />
            ) : undefined}

            {remove.error ? (
                <ErrorAlert title="That persona could not be deleted" error={remove.error} fallback="Nothing was removed." />
            ) : undefined}

            {rehearse.error ? (
                <ErrorAlert
                    title="That persona could not be rehearsed"
                    error={rehearse.error}
                    fallback="Nothing was changed — a rehearsal writes no row and cannot air."
                />
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

            <Stack gap="sm">
                {(personas.data?.personas ?? []).map(persona => (
                    <Card key={persona.id}>
                        <Group justify="space-between" align="flex-start" wrap="nowrap">
                            <Stack gap={6} style={{ minWidth: 0 }}>
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
                                <Text size="xs" c="dimmed">
                                    {summarise(persona)}
                                </Text>
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
                                <Button variant="subtle" size="compact-sm" onClick={() => setEditing(persona)}>
                                    Edit
                                </Button>
                                <Button
                                    variant="subtle"
                                    color="red"
                                    size="compact-sm"
                                    loading={remove.isPending && remove.variables === persona.id}
                                    onClick={() => remove.mutate(persona.id)}
                                >
                                    Delete
                                </Button>
                            </Group>
                        </Group>

                        {/* Keyed on the persona it was actually run for rather than simply rendered
                            under whichever card is last: one result is held at a time, and a panel
                            that stayed put while a different persona was rehearsed would attribute
                            one character's words to another. */}
                        {rehearse.data?.personaId === persona.id ? <PersonaRehearsalPanel rehearsal={rehearse.data} /> : undefined}
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
        </Stack>
    );
}

/**
 * The one line under a persona that says what it actually carries.
 *
 * Counts rather than contents: a card showing six quirks is a card nobody scans, and the two facts
 * an operator wants at a glance are whether this character can survive the model declining (its own
 * phrasings) and whether it is checked for staying in character (its markers).
 */
function summarise(persona: Persona): string {
    const parts: string[] = [];

    const phrasings = (persona.templates ?? '').split('\n').filter(line => line.trim().length > 0).length;
    parts.push(phrasings > 0 ? `${phrasings} of its own phrasings` : "the station's phrasings");

    const markers = persona.dictionMarkers?.length ?? 0;
    parts.push(markers > 0 ? `checked against ${markers} words` : 'not checked for character');

    parts.push(persona.voice ? `spoken as ${persona.voice}` : 'the default voice');
    if (persona.music) parts.push('picks its own records');

    return parts.join(' · ');
}
