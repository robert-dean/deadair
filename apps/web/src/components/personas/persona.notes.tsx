import { useState } from 'react';
import { ActionIcon, Badge, Button, Card, Group, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import type { PersonaNote } from '@deadair/sdk';

import {
    useDeletePersonaNote,
    usePersonaNotes,
    useSetPersonaNoteState,
    useUpdatePersonaNote,
    useWritePersonaNote,
} from '../../api/personas.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { PageSkeleton } from '../shared/page.skeleton';
import { StatusLamp } from '../shared/status.lamp';

/**
 * What one character has accumulated beyond its sheet.
 *
 * ## The two sections are two different questions, and the top one is the only one that asks anything
 *
 * Proposals come first because they are the only thing here waiting on a person. Everything below is
 * already in use and needs looking at only when something sounds wrong, which is the opposite of the
 * usual "newest first" and is deliberate: a panel that buried three proposals under twenty active
 * notes would be a panel where the pass quietly stopped mattering.
 *
 * ## Reject and delete are both offered, and they are not the same button
 *
 * `rejected` is a state that outlives the pass that proposed it. Delete a proposal and the next run
 * over the same scripts writes it again, forever — so the proposal section offers Reject, and the
 * active section offers Delete, and neither offers both. The one place an operator can genuinely want
 * the other verb is a rejected note they have changed their mind about, which is what the third
 * section is for.
 *
 * ## The quote is what a decision is actually made on
 *
 * A proposal is drawn with the words the station said, because "has taken to calling the listener a
 * shipmate" is not judgeable and the line it was drawn from is. The same reason `facts.source_quote`
 * is `not null`.
 */
export function PersonaNotesPanel({ personaId }: { personaId: string }) {
    const notes = usePersonaNotes(personaId);
    const write = useWritePersonaNote();
    const update = useUpdatePersonaNote();
    const remove = useDeletePersonaNote();
    const setState = useSetPersonaNoteState();

    const all = notes.data?.notes ?? [];
    const suggested = all.filter(note => note.state === 'suggested');
    const active = all.filter(note => note.state === 'active');
    const rejected = all.filter(note => note.state === 'rejected');

    const busy = write.isPending || update.isPending || remove.isPending || setState.isPending;

    return (
        <Card withBorder mt="sm" padding="sm">
            <Stack gap="sm">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Eyebrow>Notebook</Eyebrow>
                    <Text size="xs" c="dimmed" ta="right">
                        what this character has settled into, and what it has said before
                    </Text>
                </Group>

                {notes.error ? (
                    <ErrorAlert title="The notebook could not be loaded" error={notes.error} fallback="Nothing about this character has changed." />
                ) : undefined}

                {write.error ?? update.error ?? remove.error ?? setState.error ? (
                    <ErrorAlert
                        title="That note could not be saved"
                        error={write.error ?? update.error ?? remove.error ?? setState.error!}
                        fallback="The notebook is as it was."
                    />
                ) : undefined}

                {notes.isPending ? <PageSkeleton variant="card" /> : undefined}

                {suggested.length > 0 ? (
                    <Stack gap="xs">
                        <Eyebrow c="grape">Proposed</Eyebrow>
                        {suggested.map(note => (
                            <NoteRow
                                key={note.id}
                                note={note}
                                busy={busy}
                                actions={
                                    <>
                                        <Button
                                            variant="light"
                                            size="compact-xs"
                                            disabled={busy}
                                            onClick={() => setState.mutate({ id: personaId, noteId: note.id, state: 'active' })}
                                        >
                                            Accept
                                        </Button>
                                        {/* Not a delete. A deleted proposal comes back on the next
                                            pass over the same scripts, forever. */}
                                        <Button
                                            variant="subtle"
                                            size="compact-xs"
                                            disabled={busy}
                                            onClick={() => setState.mutate({ id: personaId, noteId: note.id, state: 'rejected' })}
                                        >
                                            Reject
                                        </Button>
                                    </>
                                }
                                onSave={value => update.mutate({ id: personaId, noteId: note.id, body: { kind: note.kind, note: value } })}
                            />
                        ))}
                    </Stack>
                ) : undefined}

                <Stack gap="xs">
                    <Eyebrow>In use</Eyebrow>
                    {active.map(note => (
                        <NoteRow
                            key={note.id}
                            note={note}
                            busy={busy}
                            actions={
                                <Button
                                    variant="subtle"
                                    color="red"
                                    size="compact-xs"
                                    disabled={busy}
                                    onClick={() => remove.mutate({ id: personaId, noteId: note.id })}
                                >
                                    Delete
                                </Button>
                            }
                            onSave={value => update.mutate({ id: personaId, noteId: note.id, body: { kind: note.kind, note: value } })}
                        />
                    ))}

                    {active.length === 0 && !notes.isPending ? (
                        <EmptyState>
                            This character has accumulated nothing yet, which is an ordinary state: its breaks are written from its sheet alone, exactly
                            as they were before there was a notebook. Write a note, or let the station propose one from what it has already said.
                        </EmptyState>
                    ) : undefined}
                </Stack>

                {rejected.length > 0 ? (
                    <Stack gap="xs">
                        <Eyebrow>Turned down</Eyebrow>
                        {rejected.map(note => (
                            <NoteRow
                                key={note.id}
                                note={note}
                                busy={busy}
                                actions={
                                    <Button
                                        variant="subtle"
                                        size="compact-xs"
                                        disabled={busy}
                                        onClick={() => setState.mutate({ id: personaId, noteId: note.id, state: 'active' })}
                                    >
                                        Use anyway
                                    </Button>
                                }
                            />
                        ))}
                        <Text size="xs" c="dimmed">
                            Kept rather than deleted, so the station does not propose them again.
                        </Text>
                    </Stack>
                ) : undefined}

                <NoteComposer
                    busy={busy}
                    onWrite={(kind, note) => write.mutate({ id: personaId, body: { kind, note } }, { onSuccess: () => undefined })}
                />
            </Stack>
        </Card>
    );
}

/**
 * One note, editable in place.
 *
 * Editing is offered on a proposal as much as on an active note, because half the value of the pass
 * is a line that is nearly right: an operator who can only accept or reject a nearly-right sentence
 * rejects it, and the observation is lost with the wording.
 */
function NoteRow({
    note,
    actions,
    busy,
    onSave,
}: {
    note: PersonaNote;
    actions: React.ReactNode;
    busy: boolean;
    onSave?: (value: string) => void;
}) {
    const [draft, setDraft] = useState<string | undefined>(undefined);
    const editing = draft !== undefined;

    return (
        <Stack gap="xxs">
            <Group gap="xs" wrap="nowrap" align="flex-start">
                {/* `off` for both, because nothing in a notebook is a state of the station: an active
                    note is not the station working and a rejected one is not it broken. The kind is
                    the fact worth seeing, and it is what decides which turn of the prompt it lands in. */}
                <StatusLamp tone="off" label={note.kind === 'trait' ? 'settled into' : 'said before'} />
                {note.origin === 'model' ? (
                    <Badge size="xs" variant="light" color="grape" tt="none">
                        the station&apos;s
                    </Badge>
                ) : undefined}
                <Group gap="xxs" ml="auto" wrap="nowrap">
                    {onSave === undefined ? undefined : editing ? (
                        <>
                            <Button
                                variant="light"
                                size="compact-xs"
                                disabled={busy || draft.trim().length === 0}
                                onClick={() => {
                                    onSave(draft);
                                    setDraft(undefined);
                                }}
                            >
                                Save
                            </Button>
                            <ActionIcon variant="subtle" size="sm" onClick={() => setDraft(undefined)} aria-label="Stop editing">
                                ×
                            </ActionIcon>
                        </>
                    ) : (
                        <Button variant="subtle" size="compact-xs" disabled={busy} onClick={() => setDraft(note.note)}>
                            Edit
                        </Button>
                    )}
                    {editing ? undefined : actions}
                </Group>
            </Group>

            {editing ? (
                <TextInput value={draft} onChange={event => setDraft(event.currentTarget.value)} size="xs" maxLength={500} />
            ) : (
                <Text size="sm">{note.note}</Text>
            )}

            {/* What the decision is actually made on. Only a note the station wrote has one, and only
                the words matter — the attempt it came from is swept nightly and the quote is not. */}
            {note.sourceQuote ? (
                <Tooltip label="What the station actually said, which is what this note was drawn from" withArrow>
                    <Text size="xs" c="dimmed" fs="italic">
                        &ldquo;{note.sourceQuote}&rdquo;
                    </Text>
                </Tooltip>
            ) : undefined}
        </Stack>
    );
}

/** The one an operator writes by hand. Active from the moment it exists; only the pass proposes. */
function NoteComposer({ busy, onWrite }: { busy: boolean; onWrite: (kind: 'said' | 'trait', note: string) => void }) {
    const [kind, setKind] = useState<'said' | 'trait'>('trait');
    const [note, setNote] = useState('');

    const submit = () => {
        if (note.trim().length === 0) return;
        onWrite(kind, note.trim());
        setNote('');
    };

    return (
        <Group gap="xs" wrap="nowrap" align="flex-end">
            <Select
                size="xs"
                w={150}
                label="Kind"
                data={[
                    { value: 'trait', label: 'Settled into' },
                    { value: 'said', label: 'Said before' },
                ]}
                value={kind}
                onChange={value => setKind(value === 'said' ? 'said' : 'trait')}
                allowDeselect={false}
            />
            <TextInput
                size="xs"
                style={{ flex: 1 }}
                label="A note"
                placeholder="calls the listener a shipmate"
                maxLength={500}
                value={note}
                onChange={event => setNote(event.currentTarget.value)}
                onKeyDown={event => {
                    if (event.key === 'Enter') submit();
                }}
            />
            <Button size="compact-sm" disabled={busy || note.trim().length === 0} onClick={submit}>
                Add
            </Button>
        </Group>
    );
}
