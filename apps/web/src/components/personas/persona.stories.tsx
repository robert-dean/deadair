import { useState } from 'react';
import { ActionIcon, Badge, Button, Card, Group, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import type { PersonaStory } from '@deadair/sdk';

import {
    useAddPersonaStoryBeat,
    useAddPersonaStoryDetail,
    useDeletePersonaStory,
    useDeletePersonaStoryBeat,
    useDeletePersonaStoryDetail,
    usePersonaStories,
    useSetPersonaStoryBeatState,
    useSetPersonaStoryDetailState,
    useSetPersonaStoryState,
    useUpdatePersonaStory,
    useWritePersonaStory,
} from '../../api/personas.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { PageSkeleton } from '../shared/page.skeleton';
import { StatusLamp } from '../shared/status.lamp';

/**
 * What has happened to one character, in its own telling.
 *
 * `PersonaNotesPanel`'s shape one table over, and every rule it argues holds here: proposals first
 * because they are the only thing waiting on a person, Reject rather than Delete on a proposal
 * because a rejection has to outlive the pass that made it, and editing offered on a proposal because
 * half the value of the pass is a story that is nearly right.
 *
 * ## Two things are its own
 *
 * A story has DETAILS, drawn under it, because that is what it means for one to grow — and each is
 * accepted or turned down on its own, which is the whole reason a detail is a row rather than a
 * rewrite of the telling.
 *
 * And a story carries how often it has actually gone out. That number is the one thing on this page
 * an operator cannot infer from anywhere else, and it is what makes the rotation legible: a story
 * showing "told three times" beside one showing nothing is the shelf working rather than the same
 * anecdote every night.
 */
export function PersonaStoriesPanel({ personaId }: { personaId: string }) {
    const stories = usePersonaStories(personaId);
    const write = useWritePersonaStory();
    const update = useUpdatePersonaStory();
    const remove = useDeletePersonaStory();
    const setState = useSetPersonaStoryState();
    const addDetail = useAddPersonaStoryDetail();
    const removeDetail = useDeletePersonaStoryDetail();
    const setDetailState = useSetPersonaStoryDetailState();
    const addBeat = useAddPersonaStoryBeat();
    const removeBeat = useDeletePersonaStoryBeat();
    const setBeatState = useSetPersonaStoryBeatState();

    const all = stories.data?.stories ?? [];
    const suggested = all.filter(story => story.state === 'suggested');
    const active = all.filter(story => story.state === 'active');
    const rejected = all.filter(story => story.state === 'rejected');

    const busy =
        write.isPending ||
        update.isPending ||
        remove.isPending ||
        setState.isPending ||
        addDetail.isPending ||
        removeDetail.isPending ||
        setDetailState.isPending ||
        addBeat.isPending ||
        removeBeat.isPending ||
        setBeatState.isPending;

    const failure =
        write.error ??
        update.error ??
        remove.error ??
        setState.error ??
        addDetail.error ??
        removeDetail.error ??
        setDetailState.error ??
        addBeat.error ??
        removeBeat.error ??
        setBeatState.error;

    const row = (story: PersonaStory, actions: React.ReactNode) => (
        <StoryRow
            key={story.id}
            story={story}
            busy={busy}
            actions={actions}
            onSave={(title, telling, kind) => update.mutate({ id: personaId, storyId: story.id, body: { title, story: telling, kind } })}
            onAddBeat={(ordinal, text) => addBeat.mutate({ id: personaId, storyId: story.id, body: { ordinal, beat: text } })}
            onAcceptBeat={beatId => setBeatState.mutate({ id: personaId, storyId: story.id, beatId, state: 'active' })}
            onRejectBeat={beatId => setBeatState.mutate({ id: personaId, storyId: story.id, beatId, state: 'rejected' })}
            onDeleteBeat={beatId => removeBeat.mutate({ id: personaId, storyId: story.id, beatId })}
            onAddDetail={detail => addDetail.mutate({ id: personaId, storyId: story.id, body: { detail } })}
            onAcceptDetail={detailId => setDetailState.mutate({ id: personaId, storyId: story.id, detailId, state: 'active' })}
            onRejectDetail={detailId => setDetailState.mutate({ id: personaId, storyId: story.id, detailId, state: 'rejected' })}
            onDeleteDetail={detailId => removeDetail.mutate({ id: personaId, storyId: story.id, detailId })}
        />
    );

    return (
        <Card withBorder mt="sm" padding="sm">
            <Stack gap="sm">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Eyebrow>Stories</Eyebrow>
                    <Text size="xs" c="dimmed" ta="right">
                        things that have happened to this character, told on air
                    </Text>
                </Group>

                {stories.error ? (
                    <ErrorAlert title="The stories could not be loaded" error={stories.error} fallback="Nothing about this character has changed." />
                ) : undefined}

                {failure ? <ErrorAlert title="That story could not be saved" error={failure} fallback="The shelf is as it was." /> : undefined}

                {stories.isPending ? <PageSkeleton variant="card" /> : undefined}

                {suggested.length > 0 ? (
                    <Stack gap="xs">
                        <Eyebrow c="grape">Proposed</Eyebrow>
                        {suggested.map(story =>
                            row(
                                story,
                                <>
                                    <Button
                                        variant="light"
                                        size="compact-xs"
                                        disabled={busy}
                                        onClick={() => setState.mutate({ id: personaId, storyId: story.id, state: 'active' })}
                                    >
                                        Accept
                                    </Button>
                                    {/* Not a delete: the pass reads the same catalogue back and would
                                        propose it again, forever. */}
                                    <Button
                                        variant="subtle"
                                        size="compact-xs"
                                        disabled={busy}
                                        onClick={() => setState.mutate({ id: personaId, storyId: story.id, state: 'rejected' })}
                                    >
                                        Reject
                                    </Button>
                                </>,
                            ),
                        )}
                    </Stack>
                ) : undefined}

                <Stack gap="xs">
                    <Eyebrow>Tellable</Eyebrow>
                    {active.map(story =>
                        row(
                            story,
                            <Button
                                variant="subtle"
                                color="red"
                                size="compact-xs"
                                disabled={busy}
                                onClick={() => remove.mutate({ id: personaId, storyId: story.id })}
                            >
                                Delete
                            </Button>,
                        ),
                    )}

                    {active.length === 0 && !stories.isPending ? (
                        <EmptyState>
                            This character has nothing to tell, which is an ordinary state: its breaks are written from its sheet alone, and a story
                            band on the clock passes its slot over rather than inventing a past. Write one, and the station will tell it.
                        </EmptyState>
                    ) : undefined}
                </Stack>

                {rejected.length > 0 ? (
                    <Stack gap="xs">
                        <Eyebrow>Turned down</Eyebrow>
                        {rejected.map(story =>
                            row(
                                story,
                                <Button
                                    variant="subtle"
                                    size="compact-xs"
                                    disabled={busy}
                                    onClick={() => setState.mutate({ id: personaId, storyId: story.id, state: 'active' })}
                                >
                                    Tell it anyway
                                </Button>,
                            ),
                        )}
                        <Text size="xs" c="dimmed">
                            Kept rather than deleted, so the station does not propose them again.
                        </Text>
                    </Stack>
                ) : undefined}

                <StoryComposer busy={busy} onWrite={(title, story) => write.mutate({ id: personaId, body: { title, story } })} />
            </Stack>
        </Card>
    );
}

/** One story, its details, and everything that can be done to either. Editable in place. */
/**
 * What an operator is choosing between, in their words rather than the column's.
 *
 * The labels say what each one DOES on air, because "arc" and "bit" are this codebase's words for
 * them and an operator picking from a list has no reason to know either.
 */
const KINDS = [
    { value: 'anecdote', label: 'A one-off — told whole, whenever it comes round' },
    { value: 'arc', label: 'A story in parts — one part per break, in order' },
    { value: 'bit', label: 'A running joke — returned to and built on, with no end' },
];

function StoryRow({
    story,
    actions,
    busy,
    onSave,
    onAddDetail,
    onAcceptDetail,
    onRejectDetail,
    onDeleteDetail,
    onAddBeat,
    onAcceptBeat,
    onRejectBeat,
    onDeleteBeat,
}: {
    story: PersonaStory;
    actions: React.ReactNode;
    busy: boolean;
    onSave: (title: string, story: string, kind: PersonaStory['kind']) => void;
    onAddDetail: (detail: string) => void;
    onAcceptDetail: (detailId: string) => void;
    onRejectDetail: (detailId: string) => void;
    onDeleteDetail: (detailId: string) => void;
    onAddBeat: (ordinal: number, beat: string) => void;
    onAcceptBeat: (beatId: string) => void;
    onRejectBeat: (beatId: string) => void;
    onDeleteBeat: (beatId: string) => void;
}) {
    const [draft, setDraft] = useState<{ title: string; story: string; kind: PersonaStory['kind'] } | undefined>(undefined);
    const [beat, setBeat] = useState('');
    const [detail, setDetail] = useState('');
    const editing = draft !== undefined;

    const details = story.details.filter(held => held.state !== 'rejected');
    const beats = story.beats.filter(held => held.state !== 'rejected');

    return (
        <Stack gap="xxs">
            <Group gap="xs" wrap="nowrap" align="flex-start">
                {/* `off`, for the notebook's reason: nothing on this shelf is a state of the station.
                    What is worth seeing is whether a listener has heard it. */}
                <StatusLamp
                    tone="off"
                    label={story.timesTold === 0 ? 'never told' : `told ${story.timesTold === 1 ? 'once' : `${story.timesTold} times`}`}
                />
                {story.origin === 'model' ? (
                    <Badge size="xs" variant="light" color="grape" tt="none">
                        the station&apos;s
                    </Badge>
                ) : undefined}
                <Group gap="xxs" ml="auto" wrap="nowrap">
                    {editing ? (
                        <>
                            <Button
                                variant="light"
                                size="compact-xs"
                                disabled={busy || draft.title.trim().length === 0 || draft.story.trim().length === 0}
                                onClick={() => {
                                    onSave(draft.title.trim(), draft.story.trim(), draft.kind);
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
                        <Button
                            variant="subtle"
                            size="compact-xs"
                            disabled={busy}
                            onClick={() => setDraft({ title: story.title, story: story.story, kind: story.kind })}
                        >
                            Edit
                        </Button>
                    )}
                    {editing ? undefined : actions}
                </Group>
            </Group>

            {editing ? (
                <Stack gap="xxs">
                    <TextInput
                        value={draft.title}
                        onChange={event => setDraft({ ...draft, title: event.currentTarget.value })}
                        size="xs"
                        maxLength={200}
                        aria-label="What this story is called"
                    />
                    <Textarea
                        value={draft.story}
                        onChange={event => setDraft({ ...draft, story: event.currentTarget.value })}
                        size="xs"
                        autosize
                        minRows={3}
                        maxLength={4000}
                        aria-label="The story"
                    />
                    {/* Changing an anecdote into an arc is the ordinary way one starts: somebody
                        writes a story, then thinks of where it goes. Changing it back leaves any
                        parts where they are rather than deleting them. */}
                    <Select
                        size="xs"
                        value={draft.kind}
                        onChange={value => setDraft({ ...draft, kind: (value ?? 'anecdote') as PersonaStory['kind'] })}
                        data={KINDS}
                        aria-label="What sort of story this is"
                        allowDeselect={false}
                    />
                </Stack>
            ) : (
                <>
                    <Text size="sm" fw={500}>
                        {story.title}
                    </Text>
                    <Text size="sm">{story.story}</Text>
                </>
            )}

            {/* What a proposal was drawn from, which is what the decision is made on. Never evidence:
                a story is not a claim about the world, so this only ever says where the idea came
                from. See `persona.story.ts`. */}
            {story.source ? (
                <Text size="xs" c="dimmed" fs="italic">
                    from {story.source}
                </Text>
            ) : undefined}

            {story.kind === 'arc' ? (
                <Stack gap="xxs" pl="md">
                    {/* In telling order, with the one that goes out next marked. Only ACTIVE parts
                        are ever told, so a proposal sits in the list without being counted. */}
                    {beats.map((part, at) => (
                        <Group key={part.id} gap="xs" wrap="nowrap" align="flex-start">
                            <Text size="xs" c="dimmed" className="da-num" style={{ minWidth: '2.5rem' }}>
                                {part.ordinal}
                            </Text>
                            <Text size="xs" c={part.state === 'suggested' ? 'grape' : undefined} style={{ flex: 1 }}>
                                {part.state === 'suggested' ? 'proposed: ' : ''}
                                {part.beat}
                            </Text>
                            {at === 0 && part.state === 'active' ? (
                                <Badge size="xs" variant="light" color="teal" tt="none">
                                    next
                                </Badge>
                            ) : undefined}
                            {part.state === 'suggested' ? (
                                <>
                                    <Button variant="light" size="compact-xs" disabled={busy} onClick={() => onAcceptBeat(part.id)}>
                                        Keep
                                    </Button>
                                    <Button variant="subtle" size="compact-xs" disabled={busy} onClick={() => onRejectBeat(part.id)}>
                                        Reject
                                    </Button>
                                </>
                            ) : (
                                <Button variant="subtle" color="red" size="compact-xs" disabled={busy} onClick={() => onDeleteBeat(part.id)}>
                                    Delete
                                </Button>
                            )}
                        </Group>
                    ))}
                    <Group gap="xs" wrap="nowrap">
                        <TextInput
                            size="xs"
                            style={{ flex: 1 }}
                            placeholder="what happens next in it"
                            maxLength={4000}
                            value={beat}
                            onChange={event => setBeat(event.currentTarget.value)}
                            onKeyDown={event => {
                                if (event.key !== 'Enter' || beat.trim().length === 0) return;
                                // Ten past the last, so there is always room to put something
                                // between two parts without renumbering either of them.
                                onAddBeat((beats.at(-1)?.ordinal ?? 0) + 10, beat.trim());
                                setBeat('');
                            }}
                            aria-label="The next part of this story"
                        />
                    </Group>
                </Stack>
            ) : undefined}

            {details.length > 0 ? (
                <Stack gap="xxs" pl="md">
                    {details.map(held => (
                        <Group key={held.id} gap="xs" wrap="nowrap" align="flex-start">
                            <Text size="xs" c={held.state === 'suggested' ? 'grape' : 'dimmed'} style={{ flex: 1 }}>
                                {held.state === 'suggested' ? '· proposed: ' : '· '}
                                {held.detail}
                            </Text>
                            {held.state === 'suggested' ? (
                                <>
                                    <Button variant="light" size="compact-xs" disabled={busy} onClick={() => onAcceptDetail(held.id)}>
                                        Keep
                                    </Button>
                                    <Button variant="subtle" size="compact-xs" disabled={busy} onClick={() => onRejectDetail(held.id)}>
                                        Reject
                                    </Button>
                                </>
                            ) : (
                                <Button variant="subtle" color="red" size="compact-xs" disabled={busy} onClick={() => onDeleteDetail(held.id)}>
                                    Delete
                                </Button>
                            )}
                        </Group>
                    ))}
                </Stack>
            ) : undefined}

            <Group gap="xs" wrap="nowrap" pl="md">
                <TextInput
                    size="xs"
                    style={{ flex: 1 }}
                    placeholder="something else you remember about it"
                    maxLength={1000}
                    value={detail}
                    onChange={event => setDetail(event.currentTarget.value)}
                    onKeyDown={event => {
                        if (event.key !== 'Enter' || detail.trim().length === 0) return;
                        onAddDetail(detail.trim());
                        setDetail('');
                    }}
                    aria-label={`Add a detail to ${story.title}`}
                />
                <Button
                    size="compact-xs"
                    variant="subtle"
                    disabled={busy || detail.trim().length === 0}
                    onClick={() => {
                        onAddDetail(detail.trim());
                        setDetail('');
                    }}
                >
                    Add detail
                </Button>
            </Group>
        </Stack>
    );
}

/**
 * The one an operator writes by hand. Tellable from the moment it exists; only the pass proposes.
 *
 * The placeholder is doing real work: the station reads a story out AS WRITTEN when there is no model
 * available, so what belongs in the box is a script rather than a note towards one.
 */
function StoryComposer({ busy, onWrite }: { busy: boolean; onWrite: (title: string, story: string) => void }) {
    const [title, setTitle] = useState('');
    const [story, setStory] = useState('');

    const submit = () => {
        if (title.trim().length === 0 || story.trim().length === 0) return;
        onWrite(title.trim(), story.trim());
        setTitle('');
        setStory('');
    };

    return (
        <Stack gap="xs">
            <TextInput
                size="xs"
                label="What you call it"
                description="Never said out loud. It is how this list is read, and how the station names one in a log."
                placeholder="The Barstow lights"
                maxLength={200}
                value={title}
                onChange={event => setTitle(event.currentTarget.value)}
            />
            <Textarea
                size="xs"
                label="The story"
                description="In this character's own voice, and out loud: with no model available the station reads it exactly as you write it."
                placeholder="You saw three lights over the desert outside Barstow in ninety-seven. No sound at all, and gone before the tape was running."
                autosize
                minRows={3}
                maxLength={4000}
                value={story}
                onChange={event => setStory(event.currentTarget.value)}
            />
            <Group justify="flex-end">
                <Button size="compact-sm" disabled={busy || title.trim().length === 0 || story.trim().length === 0} onClick={submit}>
                    Add
                </Button>
            </Group>
        </Stack>
    );
}
