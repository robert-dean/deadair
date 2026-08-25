import { useState } from 'react';
import { ActionIcon, Button, Card, Group, Stack, Table, Text } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import type { Topic, TopicInput, TopicKindDescriptor } from '@deadair/sdk';

import { useClockBands } from '../../api/clock.queries';
import { useCreateTopic, useDeleteTopic, useTopicKinds, useTopics, useUpdateTopic } from '../../api/topics.queries';
import { ConfirmModal } from '../shared/confirm.modal';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { TopicEditor, type TopicTarget } from './topic.editor';

/**
 * What the station's breaks can be about.
 *
 * News categories today, and the same page will draw weather locations the day that kind exists —
 * which is the whole point of the vocabulary being one chassis: the KINDS come from the API, each
 * one carrying its own noun and its own fields, so nothing here knows what a news category is.
 *
 * ## Grouped by kind, and a kind with nothing in it still shows
 *
 * A station that has deleted every category has a `news` kind and no rows, which is a state worth
 * being able to see and add to. Building the page from the rows alone would leave no way back.
 *
 * ## Deleting is confirmed, and says what goes with it
 *
 * A band on the format clock that asked for this subject goes too, because a band that quietly lost
 * its subject would read a general break under this name — the failure the whole feature exists to
 * prevent. There is no restore, unlike the personas page: a category is a few words an operator
 * wrote and the seeds are only a starting vocabulary, so the control worth having is the
 * confirmation rather than a way back.
 */
export function TopicsPage() {
    const kinds = useTopicKinds();
    const topics = useTopics();
    // Only to say what else a delete takes. The schedule page already draws this list, so it is a
    // cached read rather than a call this page pays for.
    const clock = useClockBands();
    const create = useCreateTopic();
    const update = useUpdateTopic();
    const remove = useDeleteTopic();

    const [editing, setEditing] = useState<{ kind: TopicKindDescriptor; target: TopicTarget } | undefined>(undefined);

    // The subject being deleted, with the number of bands that asked for it counted at the moment
    // the question was asked rather than while it is on screen: the clock is not moving underneath
    // this and a count that changed mid-dialog would be a different question than the one answered.
    const [deleting, setDeleting] = useState<{ topic: Topic; bands: number } | undefined>(undefined);

    const close = () => {
        setEditing(undefined);
        create.reset();
        update.reset();
    };

    const submit = async (draft: TopicInput) => {
        if (editing?.target.kind === 'edit') await update.mutateAsync({ id: editing.target.topic.id, body: draft });
        else await create.mutateAsync(draft);

        close();
    };

    const all = topics.data?.topics ?? [];
    const bands = clock.data?.bands ?? [];

    return (
        <Stack gap="lg">
            <PageHeader
                title="Subjects"
                description={
                    <Text c="dimmed" size="sm">
                        What a break can be about. Put one on a band in the format clock and that break covers only its subject — a technology
                        bulletin at half past, the local news at six. Leave a band without one and the station spreads what it has.
                    </Text>
                }
            />

            {kinds.error ? (
                <ErrorAlert title="The subjects could not be loaded" error={kinds.error} fallback="This station's vocabulary is unavailable." />
            ) : undefined}

            {remove.error ? <ErrorAlert title="That could not be deleted" error={remove.error} fallback="Nothing was removed." /> : undefined}

            {kinds.isPending || topics.isPending ? <PageSkeleton variant="card" /> : undefined}

            {kinds.data && kinds.data.kinds.length === 0 ? (
                <EmptyState title="Nothing on this station takes a subject yet">
                    Subjects belong to a sort of break — news categories, and weather locations when the station can talk about the weather. None of
                    the breaks this station can write has anything to be about, so there is nothing to name here.
                </EmptyState>
            ) : undefined}

            {(kinds.data?.kinds ?? []).map(kind => {
                const held = all.filter(topic => topic.kind === kind.kind);

                return (
                    <Card key={kind.kind} padding="lg">
                        <Stack gap="sm">
                            <Group justify="space-between" align="flex-start">
                                <Stack gap={2}>
                                    <Eyebrow>{kind.nounMany}</Eyebrow>
                                    <Text size="sm" c="dimmed" maw={620}>
                                        {kind.description}
                                    </Text>
                                </Stack>
                                <Button
                                    size="xs"
                                    variant="light"
                                    onClick={() =>
                                        setEditing({
                                            kind,
                                            target: { kind: 'new', position: (held.at(-1)?.position ?? -1) + 1 },
                                        })
                                    }
                                >
                                    New {kind.nounOne}
                                </Button>
                            </Group>

                            {/* A line rather than `EmptyState`, deliberately: that component is a
                                Card, and this sits inside the per-kind Card that already carries
                                the heading and the New button. A card inside a card reads as a
                                second thing on the page rather than as the inside of this one. */}
                            {held.length === 0 ? (
                                <Text size="sm" c="dimmed">
                                    No {kind.nounMany} yet, which is a working station: every break of this sort covers whatever it finds.
                                </Text>
                            ) : (
                                <Table verticalSpacing="xs" highlightOnHover>
                                    <Table.Tbody>
                                        {held.map(topic => (
                                            <Table.Tr
                                                key={topic.id}
                                                style={{ cursor: 'pointer' }}
                                                onClick={() => setEditing({ kind, target: { kind: 'edit', topic } })}
                                            >
                                                <Table.Td w={220}>
                                                    <Text size="sm">{topic.label}</Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size="xs" c="dimmed">
                                                        {summarize(topic, kind)}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td w={60}>
                                                    <Group gap={2} justify="flex-end" onClick={event => event.stopPropagation()}>
                                                        <ActionIcon
                                                            size="sm"
                                                            variant="subtle"
                                                            color="red"
                                                            aria-label={`Delete ${topic.label}`}
                                                            loading={remove.isPending}
                                                            onClick={() => {
                                                                // A band that asked for this goes
                                                                // with it: one that quietly lost its
                                                                // subject would read a general break
                                                                // under this name, which is the
                                                                // failure the whole feature exists
                                                                // to prevent. The count is read here
                                                                // rather than in the dialog so the
                                                                // dialog stays a dumb question.
                                                                setDeleting({
                                                                    topic,
                                                                    bands: bands.filter(band => band.topicId === topic.id).length,
                                                                });
                                                            }}
                                                        >
                                                            <IconTrash size={14} />
                                                        </ActionIcon>
                                                    </Group>
                                                </Table.Td>
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                            )}
                        </Stack>
                    </Card>
                );
            })}

            {editing ? (
                <TopicEditor
                    // Keyed on what it is open on, so the form reads its values once per subject
                    // rather than keeping the last one's under a new title.
                    key={editing.target.kind === 'edit' ? editing.target.topic.id : `new:${editing.kind.kind}:${editing.target.position}`}
                    target={editing.target}
                    kind={editing.kind}
                    onClose={close}
                    onSubmit={submit}
                    pending={create.isPending || update.isPending}
                    error={create.error ?? update.error}
                />
            ) : undefined}

            <ConfirmModal
                opened={deleting !== undefined}
                onClose={() => setDeleting(undefined)}
                onConfirm={() => {
                    if (deleting === undefined) return;
                    remove.mutate(deleting.topic.id, { onSuccess: () => setDeleting(undefined) });
                }}
                title={deleting ? `Delete ${deleting.topic.label}?` : 'Delete this subject?'}
                confirmLabel="Delete"
                confirming={remove.isPending}
                error={remove.error}
                errorTitle="That subject could not be deleted"
                errorFallback="Nothing was removed."
            >
                {deleting ? warningFor(deleting.bands) : ''}
            </ConfirmModal>
        </Stack>
    );
}

/** What deleting this takes with it, said before it happens. */
/**
 * What goes with the subject, or the plain fact that nothing does.
 *
 * The title already asks the question, so this is only the consequence. A subject nothing points at
 * still gets a sentence rather than an empty dialog: "nothing else changes" is the answer an
 * operator came for, and a dialog with only buttons in it reads as a dialog that failed to load.
 */
function warningFor(bands: number): string {
    if (bands === 0) return 'Nothing on the format clock asks for it, so nothing else changes.';

    return `${bands} band${bands === 1 ? '' : 's'} on the format clock ${bands === 1 ? 'asks' : 'ask'} for it and will go too.`;
}

/**
 * What this subject is matched on, in one line.
 *
 * Built from the kind's own fields rather than from anything news-shaped, so the row says something
 * useful for a kind this file has never heard of. A subject with nothing filled in says so, which is
 * the state worth spotting from the list: it is what makes a break asking for it fall silent.
 */
function summarize(topic: Topic, kind: TopicKindDescriptor): string {
    // The field's own label with a count after it, rather than a count with the label as a noun:
    // a descriptor's label is a sentence ("The publisher's own words for it") and "4 the publisher's
    // own words for it" is not English. This stays readable for a kind this file has never seen.
    const parts = kind.fields.flatMap(field => {
        const entries = entriesIn(topic.config[field.key]);
        return entries.length === 0 ? [] : [`${field.label} (${entries.length})`];
    });

    return parts.length === 0 ? 'nothing to match on yet' : parts.join(' · ');
}

/** Whatever a field holds, as the list it stands for: an array, lines, or a comma list. */
function entriesIn(value: unknown): string[] {
    const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,]/) : [];

    return parts.flatMap(part => (typeof part === 'string' && part.trim().length > 0 ? [part.trim()] : []));
}
