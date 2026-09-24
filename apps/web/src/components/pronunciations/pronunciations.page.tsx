import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Card, Group, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconCheck, IconPencil, IconTrash, IconX } from '@tabler/icons-react';
import type { Pronunciation } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import {
    useCreatePronunciation,
    useDeletePronunciation,
    usePronunciations,
    useSetPronunciationState,
    useUpdatePronunciation,
} from '../../api/pronunciations.queries';
import { ConfirmModal } from '../shared/confirm.modal';
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
    const { t } = useTranslation(['pronunciations', 'common']);
    const lexicon = usePronunciations();
    const create = useCreatePronunciation();
    const update = useUpdatePronunciation();
    const setState = useSetPronunciationState();
    const remove = useDeletePronunciation();

    const [written, setWritten] = useState('');
    const [spoken, setSpoken] = useState('');
    const [editing, setEditing] = useState<{ id: string; written: string; spoken: string } | undefined>(undefined);

    // The entry being deleted, held whole rather than by id: the dialog says the words back, and
    // reading them out of the list again would mean finding the row a second time.
    const [deleting, setDeleting] = useState<Pronunciation | undefined>(undefined);

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
                title={t('title')}
                description={
                    <Text c="dimmed" size="sm">
                        {t('description')}
                    </Text>
                }
            />

            {lexicon.error ? <ErrorAlert title={t('error.load')} error={lexicon.error} fallback={t('error.loadFallback')} /> : undefined}

            {create.error ? <ErrorAlert title={t('error.add')} error={create.error} fallback={t('error.addFallback')} /> : undefined}
            {update.error ? <ErrorAlert title={t('error.save')} error={update.error} fallback={t('error.saveFallback')} /> : undefined}
            {remove.error ? <ErrorAlert title={t('error.remove')} error={remove.error} fallback={t('error.removeFallback')} /> : undefined}

            {lexicon.isPending ? <PageSkeleton variant="card" /> : undefined}

            {suggested.length > 0 ? (
                <Card padding="lg">
                    <Stack gap="sm">
                        <Stack gap={2}>
                            <Eyebrow>{t('proposed.title')}</Eyebrow>
                            <Text size="sm" c="dimmed" maw={720}>
                                {t('proposed.description')}
                            </Text>
                        </Stack>

                        <Table.ScrollContainer minWidth={600}>
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
                                                        aria-label={t('proposed.accept', { written: entry.written })}
                                                        loading={setState.isPending}
                                                        onClick={() => setState.mutate({ id: entry.id, body: { state: 'active' } })}
                                                    >
                                                        <IconCheck size={14} />
                                                    </ActionIcon>
                                                    <ActionIcon
                                                        size="sm"
                                                        variant="subtle"
                                                        color="gray"
                                                        aria-label={t('proposed.reject', { written: entry.written })}
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
                        </Table.ScrollContainer>
                    </Stack>
                </Card>
            ) : undefined}

            <Card padding="lg">
                <Stack gap="sm">
                    <Eyebrow>{t('active.title')}</Eyebrow>

                    {lexicon.data && active.length === 0 ? (
                        <EmptyState title={t('active.empty.title')}>{t('active.empty.body')}</EmptyState>
                    ) : (
                        <Table.ScrollContainer minWidth={600}>
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
                                                            aria-label={t('field.written')}
                                                            value={editing.written}
                                                            onChange={event => setEditing({ ...editing, written: event.currentTarget.value })}
                                                        />
                                                        <Text size="xs" c="dimmed">
                                                            {t('active.isSaid')}
                                                        </Text>
                                                        <TextInput
                                                            size="xs"
                                                            flex={1}
                                                            aria-label={t('field.spoken')}
                                                            value={editing.spoken}
                                                            onChange={event => setEditing({ ...editing, spoken: event.currentTarget.value })}
                                                        />
                                                        <Button size="xs" variant="light" loading={update.isPending} onClick={save}>
                                                            {t('active.save')}
                                                        </Button>
                                                        <Button size="xs" variant="subtle" color="gray" onClick={() => setEditing(undefined)}>
                                                            {t('common:action.cancel')}
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
                                                                aria-label={t('active.edit', { written: entry.written })}
                                                                onClick={() =>
                                                                    setEditing({ id: entry.id, written: entry.written, spoken: entry.spoken })
                                                                }
                                                            >
                                                                <IconPencil size={14} />
                                                            </ActionIcon>
                                                            <ActionIcon
                                                                size="sm"
                                                                variant="subtle"
                                                                color="red"
                                                                aria-label={t('active.delete', { written: entry.written })}
                                                                loading={remove.isPending}
                                                                onClick={() => setDeleting(entry)}
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
                        </Table.ScrollContainer>
                    )}

                    <Group gap="xs" align="flex-end">
                        <TextInput
                            size="xs"
                            w={{ base: '100%', sm: 200 }}
                            label={t('field.written')}
                            placeholder={t('add.writtenPlaceholder')}
                            value={written}
                            onChange={event => setWritten(event.currentTarget.value)}
                        />
                        <TextInput
                            size="xs"
                            flex={1}
                            label={t('field.said')}
                            placeholder={t('add.saidPlaceholder')}
                            value={spoken}
                            onChange={event => setSpoken(event.currentTarget.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') void add();
                            }}
                        />
                        <Button size="xs" variant="light" loading={create.isPending} disabled={written.trim().length === 0} onClick={add}>
                            {t('add.action')}
                        </Button>
                    </Group>
                </Stack>
            </Card>

            {rejected.length > 0 ? (
                <Card padding="lg">
                    <Stack gap="sm">
                        <Stack gap={2}>
                            <Eyebrow>{t('rejected.title')}</Eyebrow>
                            <Text size="sm" c="dimmed" maw={720}>
                                {t('rejected.description')}
                            </Text>
                        </Stack>

                        <Table.ScrollContainer minWidth={600}>
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
                                                        {t('rejected.restore')}
                                                    </Button>
                                                </Group>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </Table.ScrollContainer>
                    </Stack>
                </Card>
            ) : undefined}

            <ConfirmModal
                opened={deleting !== undefined}
                onClose={() => setDeleting(undefined)}
                onConfirm={() => {
                    if (deleting === undefined) return;
                    remove.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) });
                }}
                title={deleting ? t('delete.title', { written: deleting.written }) : t('delete.titleFallback')}
                confirmLabel={t('delete.confirm')}
                confirming={remove.isPending}
                error={remove.error}
                errorTitle={t('delete.errorTitle')}
                errorFallback={t('error.removeFallback')}
            >
                {deleting ? t('delete.body', { spoken: deleting.spoken }) : ''}
            </ConfirmModal>
        </Stack>
    );
}

/** One entry as a sentence: what is written, and what comes out of the engine instead. */
function Said({ entry, dimmed = false }: { entry: Pronunciation; dimmed?: boolean }) {
    const { t } = useTranslation('pronunciations');
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
                    {t('notSaid')}
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
    const { t } = useTranslation('pronunciations');
    if (entry.origin === 'operator' || entry.sourceQuote === undefined) return undefined;

    return (
        <Stack gap={2}>
            <Text size="xs" c="dimmed" lineClamp={2}>
                {entry.sourceQuote}
            </Text>
            {entry.sourceUrl === undefined ? undefined : (
                <Anchor size="xs" c="dimmed" href={entry.sourceUrl} target="_blank" rel="noreferrer noopener">
                    {t('source')}
                </Anchor>
            )}
        </Stack>
    );
}
