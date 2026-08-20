import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Card, Group, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconCheck, IconPencil, IconTrash, IconX } from '@tabler/icons-react';
import type { Pronunciation } from '@deadair/sdk';

import {
    useCreatePronunciation,
    useDeletePronunciation,
    usePronunciations,
    useSetPronunciationState,
    useUpdatePronunciation,
} from '../../api/pronunciations.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';

/**
 * How the station says a word.
 *
 * The half of speech no rule can reach: the station works out for itself that `1984` is a year and
 * that `feat.` is "featuring", and nothing in a pattern knows that one stylized name is said as the
 * letters, another as a word, and a third as neither.
 *
 * ## Three sections, because a proposal is not an entry
 *
 * Anything the station mined out of an article arrives as a PROPOSAL and says nothing until it is
 * accepted. It is shown with the sentence it came from, because that is what the decision is
 * actually made on — an article's pronunciation key is frequently about one word of a name, and
 * occasionally about a different name altogether.
 *
 * Turning one down is a state rather than a deletion, and the section stays visible for the same
 * reason: the mining pass re-reads an article whenever a plugin hands over a new copy of it, so a
 * proposal that was deleted would come back, and come back again.
 */
export function PronunciationsPage() {
    const lexicon = usePronunciations();
    const create = useCreatePronunciation();
    const update = useUpdatePronunciation();
    const setState = useSetPronunciationState();
    const remove = useDeletePronunciation();

    const [written, setWritten] = useState('');
    const [spoken, setSpoken] = useState('');
    const [editing, setEditing] = useState<{ id: string; written: string; spoken: string } | undefined>(undefined);

    const entries = lexicon.data?.pronunciations ?? [];
    const active = entries.filter(entry => entry.state === 'active');
    const suggested = entries.filter(entry => entry.state === 'suggested');
    const rejected = entries.filter(entry => entry.state === 'rejected');

    const add = async () => {
        if (written.trim().length === 0) return;

        await create.mutateAsync({ written: written.trim(), spoken: spoken.trim() });
        setWritten('');
        setSpoken('');
    };

    const save = async () => {
        if (editing === undefined) return;

        await update.mutateAsync({ id: editing.id, body: { written: editing.written.trim(), spoken: editing.spoken.trim() } });
        setEditing(undefined);
    };

    return (
        <Stack gap="lg">
            <PageHeader
                title="Pronunciations"
                description={
                    <Text c="dimmed" size="sm">
                        The names the station would otherwise read wrongly. Whatever is on the right is handed to the speech engine untouched, so
                        write it however that engine reads best — and leave it empty to drop the words entirely, which is the honest answer for a
                        marker that got into a title and is not a word.
                    </Text>
                }
            />

            {lexicon.error ? (
                <ErrorAlert
                    title="The lexicon could not be loaded"
                    error={lexicon.error}
                    fallback="What the station says differently is unavailable."
                />
            ) : undefined}

            {create.error ? <ErrorAlert title="That could not be added" error={create.error} fallback="Nothing was written." /> : undefined}
            {update.error ? <ErrorAlert title="That could not be saved" error={update.error} fallback="Nothing was changed." /> : undefined}
            {remove.error ? <ErrorAlert title="That could not be removed" error={remove.error} fallback="Nothing was removed." /> : undefined}

            {lexicon.isPending ? <PageSkeleton variant="card" /> : undefined}

            {suggested.length > 0 ? (
                <Card padding="lg">
                    <Stack gap="sm">
                        <Stack gap={2}>
                            <Eyebrow>Proposed</Eyebrow>
                            <Text size="sm" c="dimmed" maw={720}>
                                Pronunciation keys the station found printed in the articles it already holds. None of these is said until it is
                                accepted, because an article's key is often about one word of a name and sometimes about a different name entirely.
                            </Text>
                        </Stack>

                        <Table verticalSpacing="sm" highlightOnHover>
                            <Table.Tbody>
                                {suggested.map(entry => (
                                    <Table.Tr key={entry.id}>
                                        <Table.Td w={340}>
                                            <Said entry={entry} />
                                        </Table.Td>
                                        <Table.Td>
                                            <Evidence entry={entry} />
                                        </Table.Td>
                                        <Table.Td w={110}>
                                            <Group gap={4} justify="flex-end">
                                                <ActionIcon
                                                    size="sm"
                                                    variant="subtle"
                                                    color="teal"
                                                    aria-label={`Say ${entry.written} this way`}
                                                    loading={setState.isPending}
                                                    onClick={() => setState.mutate({ id: entry.id, body: { state: 'active' } })}
                                                >
                                                    <IconCheck size={14} />
                                                </ActionIcon>
                                                <ActionIcon
                                                    size="sm"
                                                    variant="subtle"
                                                    color="gray"
                                                    aria-label={`Turn down ${entry.written}`}
                                                    loading={setState.isPending}
                                                    onClick={() => setState.mutate({ id: entry.id, body: { state: 'rejected' } })}
                                                >
                                                    <IconX size={14} />
                                                </ActionIcon>
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Stack>
                </Card>
            ) : undefined}

            <Card padding="lg">
                <Stack gap="sm">
                    <Eyebrow>Said this way</Eyebrow>

                    {lexicon.data && active.length === 0 ? (
                        <EmptyState title="The station says everything as it is written">
                            Nothing here yet. Add a name whose letters are not its sounds, and the station says it your way from the next break on.
                        </EmptyState>
                    ) : (
                        <Table verticalSpacing="xs" highlightOnHover>
                            <Table.Tbody>
                                {active.map(entry => (
                                    <Table.Tr key={entry.id}>
                                        {editing?.id === entry.id ? (
                                            <Table.Td colSpan={3}>
                                                <Group gap="xs" wrap="nowrap">
                                                    <TextInput
                                                        size="xs"
                                                        w={200}
                                                        aria-label="Written"
                                                        value={editing.written}
                                                        onChange={event => setEditing({ ...editing, written: event.currentTarget.value })}
                                                    />
                                                    <Text size="xs" c="dimmed">
                                                        is said
                                                    </Text>
                                                    <TextInput
                                                        size="xs"
                                                        flex={1}
                                                        aria-label="Spoken"
                                                        value={editing.spoken}
                                                        onChange={event => setEditing({ ...editing, spoken: event.currentTarget.value })}
                                                    />
                                                    <Button size="xs" variant="light" loading={update.isPending} onClick={save}>
                                                        Save
                                                    </Button>
                                                    <Button size="xs" variant="subtle" color="gray" onClick={() => setEditing(undefined)}>
                                                        Cancel
                                                    </Button>
                                                </Group>
                                            </Table.Td>
                                        ) : (
                                            <>
                                                <Table.Td w={340}>
                                                    <Said entry={entry} />
                                                </Table.Td>
                                                <Table.Td>
                                                    <Evidence entry={entry} />
                                                </Table.Td>
                                                <Table.Td w={110}>
                                                    <Group gap={4} justify="flex-end">
                                                        <ActionIcon
                                                            size="sm"
                                                            variant="subtle"
                                                            aria-label={`Edit ${entry.written}`}
                                                            onClick={() => setEditing({ id: entry.id, written: entry.written, spoken: entry.spoken })}
                                                        >
                                                            <IconPencil size={14} />
                                                        </ActionIcon>
                                                        <ActionIcon
                                                            size="sm"
                                                            variant="subtle"
                                                            color="red"
                                                            aria-label={`Delete ${entry.written}`}
                                                            loading={remove.isPending}
                                                            onClick={() => {
                                                                if (window.confirm(`Stop saying "${entry.written}" as "${entry.spoken}"?`))
                                                                    remove.mutate(entry.id);
                                                            }}
                                                        >
                                                            <IconTrash size={14} />
                                                        </ActionIcon>
                                                    </Group>
                                                </Table.Td>
                                            </>
                                        )}
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    )}

                    <Group gap="xs" align="flex-end" wrap="nowrap">
                        <TextInput
                            size="xs"
                            w={200}
                            label="Written"
                            placeholder="Röyksopp"
                            value={written}
                            onChange={event => setWritten(event.currentTarget.value)}
                        />
                        <TextInput
                            size="xs"
                            flex={1}
                            label="Said"
                            placeholder="royk-sop"
                            value={spoken}
                            onChange={event => setSpoken(event.currentTarget.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') void add();
                            }}
                        />
                        <Button size="xs" variant="light" loading={create.isPending} disabled={written.trim().length === 0} onClick={add}>
                            Add
                        </Button>
                    </Group>
                </Stack>
            </Card>

            {rejected.length > 0 ? (
                <Card padding="lg">
                    <Stack gap="sm">
                        <Stack gap={2}>
                            <Eyebrow>Turned down</Eyebrow>
                            <Text size="sm" c="dimmed" maw={720}>
                                Kept rather than deleted, so the same article does not propose them again.
                            </Text>
                        </Stack>

                        <Table verticalSpacing="xs">
                            <Table.Tbody>
                                {rejected.map(entry => (
                                    <Table.Tr key={entry.id}>
                                        <Table.Td w={340}>
                                            <Said entry={entry} dimmed />
                                        </Table.Td>
                                        <Table.Td>
                                            <Evidence entry={entry} />
                                        </Table.Td>
                                        <Table.Td w={110}>
                                            <Group gap={4} justify="flex-end">
                                                <Button
                                                    size="compact-xs"
                                                    variant="subtle"
                                                    loading={setState.isPending}
                                                    onClick={() => setState.mutate({ id: entry.id, body: { state: 'active' } })}
                                                >
                                                    Say it
                                                </Button>
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Stack>
                </Card>
            ) : undefined}
        </Stack>
    );
}

/** One entry as a sentence: what is written, and what comes out of the engine instead. */
function Said({ entry, dimmed = false }: { entry: Pronunciation; dimmed?: boolean }) {
    return (
        <Group gap="xs" wrap="nowrap">
            <Text size="sm" fw={500} c={dimmed ? 'dimmed' : undefined}>
                {entry.written}
            </Text>
            <Text size="xs" c="dimmed">
                →
            </Text>
            {entry.spoken.length === 0 ? (
                <Badge size="xs" variant="light" color="gray">
                    not said
                </Badge>
            ) : (
                <Text size="sm" c={dimmed ? 'dimmed' : undefined}>
                    {entry.spoken}
                </Text>
            )}
        </Group>
    );
}

/**
 * Where an entry came from, when it came from anywhere.
 *
 * The quote is the whole point of showing this: an operator deciding whether "chih-KOH-nee" is how
 * to say "Madonna" needs the sentence it was lifted out of, and no summary of it will do.
 */
function Evidence({ entry }: { entry: Pronunciation }) {
    if (entry.origin === 'operator' || entry.sourceQuote === undefined) return undefined;

    return (
        <Stack gap={2}>
            <Text size="xs" c="dimmed" lineClamp={2}>
                {entry.sourceQuote}
            </Text>
            {entry.sourceUrl === undefined ? undefined : (
                <Anchor size="xs" c="dimmed" href={entry.sourceUrl} target="_blank" rel="noreferrer noopener">
                    the article
                </Anchor>
            )}
        </Stack>
    );
}
