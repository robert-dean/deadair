import { useState } from 'react';
import { Badge, Button, Card, Group, NumberInput, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import type { OwnEpisodeRequest, OwnShow, OwnShowInput, Production } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import {
    useCreateOwnShow,
    useDeleteOwnShow,
    useOwnShowEpisodes,
    useOwnShows,
    useRequestOwnEpisode,
    useUpdateOwnShow,
} from '../../api/podcast.queries';
import { usePersonas } from '../../api/personas.queries';
import { presents } from '../personas/persona.kind';
import { scheduledForOf } from '../productions/production.form';
import { toneOf } from '../productions/productions.page';
import { ConfirmModal } from '../shared/confirm.modal';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { formatMomentMinute } from '../shared/feed.moment';
import { notifyQueued } from '../shared/notify';
import { toneColor } from '../shared/status';

/** The modes, as the Productions form offers them, so an operator meets one vocabulary. */
const MODES = ['quick', 'outlined', 'polished'] as const;

/** How many of a show's episodes the card lists. The Productions page has all of them. */
const EPISODES_SHOWN = 5;

/** A show's boxes as the form holds them, before the empty ones are dropped on the way out. */
interface ShowValues {
    title: string;
    description: string;
    subject: string;
    personaId: string | null;
    minutes: number | string;
    mode: string | null;
}

/**
 * Two starting points, offered as prefilled values rather than seeded rows: a show nobody asked for is
 * clutter, and the two things these are for (something to fall asleep to, the day's news taken slowly)
 * are better as a shape an operator edits than as a row they have to find and delete.
 */
export const TEMPLATES = {
    windDown: { minutes: 40, mode: 'outlined' },
    newsInDepth: { minutes: 15, mode: 'outlined' },
} as const satisfies Record<string, { minutes: number; mode: (typeof MODES)[number] }>;

/** What the form sends: trimmed, with an empty box as nothing. */
export function showBodyOf(values: ShowValues): OwnShowInput {
    const optional = (value: string) => (value.trim().length === 0 ? undefined : value.trim());
    const description = optional(values.description);
    const subject = optional(values.subject);

    return {
        title: values.title.trim(),
        ...(description === undefined ? {} : { description }),
        ...(subject === undefined ? {} : { subject }),
        ...(values.personaId === null ? {} : { personaId: values.personaId }),
        ...(typeof values.minutes === 'number' && values.minutes > 0 ? { targetMs: values.minutes * 60_000 } : {}),
        ...(values.mode === null ? {} : { writingMode: values.mode as OwnShowInput['writingMode'] }),
    };
}

/**
 * The shows the station makes for itself, above the ones it carries.
 *
 * A show is a saved recipe and every episode is a production, so an episode asked for here is queued,
 * made and aired exactly as one asked for on the Productions page, and appears there too. What a show
 * adds is not having to say the same things every time: who presents it, how long it runs, and what it
 * is about when an episode is asked for with no subject of its own.
 */
export function OwnShows() {
    const { t } = useTranslation('podcasts');
    const shows = useOwnShows();
    const create = useCreateOwnShow();
    const [creating, setCreating] = useState(false);

    const listed = shows.data?.shows ?? [];

    return (
        <Stack gap="sm">
            <Group justify="space-between" align="flex-end">
                <div>
                    <Text fw={600}>{t('own.title')}</Text>
                    <Text size="sm" c="dimmed">
                        {t('own.description')}
                    </Text>
                </div>
                {creating ? undefined : (
                    <Button size="xs" onClick={() => setCreating(true)}>
                        {t('own.create')}
                    </Button>
                )}
            </Group>

            {shows.error ? <ErrorAlert title={t('own.error.list')} error={shows.error} /> : undefined}

            {creating ? (
                <ShowForm
                    templates
                    pending={create.isPending}
                    error={create.error}
                    onCancel={() => setCreating(false)}
                    onSubmit={body => create.mutate(body, { onSuccess: () => setCreating(false) })}
                />
            ) : undefined}

            {shows.data && listed.length === 0 && !creating ? <EmptyState>{t('own.empty')}</EmptyState> : undefined}

            {listed.map(show => (
                <ShowCard key={show.id} show={show} />
            ))}
        </Stack>
    );
}

/** One show: what it is, asking it for an episode, and its latest few. */
function ShowCard({ show }: { show: OwnShow }) {
    const { t } = useTranslation('podcasts');
    const update = useUpdateOwnShow();
    const remove = useDeleteOwnShow();
    const [mode, setMode] = useState<'idle' | 'episode' | 'edit'>('idle');
    const [deleting, setDeleting] = useState(false);

    if (mode === 'edit') {
        return (
            <ShowForm
                initial={show}
                pending={update.isPending}
                error={update.error}
                onCancel={() => setMode('idle')}
                onSubmit={body => update.mutate({ id: show.id, body }, { onSuccess: () => setMode('idle') })}
            />
        );
    }

    return (
        <Card>
            <Stack gap="sm">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap="xxs">
                        <Text fw={600}>{show.title}</Text>
                        {show.description === undefined ? undefined : (
                            <Text size="sm" c="dimmed">
                                {show.description}
                            </Text>
                        )}
                        <Text size="xs" c="dimmed">
                            {show.subject === undefined ? t('own.noSubject') : t('own.about', { subject: show.subject })}
                        </Text>
                    </Stack>
                    <Group gap="xs" wrap="nowrap">
                        {mode === 'episode' ? undefined : (
                            <Button size="xs" onClick={() => setMode('episode')}>
                                {t('own.episode.ask')}
                            </Button>
                        )}
                        <Button size="xs" variant="default" onClick={() => setMode('edit')}>
                            {t('own.edit')}
                        </Button>
                        <Button size="xs" variant="subtle" color="gray" onClick={() => setDeleting(true)}>
                            {t('own.delete.action')}
                        </Button>
                    </Group>
                </Group>

                {mode === 'episode' ? <EpisodeForm show={show} onDone={() => setMode('idle')} /> : undefined}

                <Episodes showId={show.id} />
            </Stack>

            <ConfirmModal
                opened={deleting}
                onClose={() => setDeleting(false)}
                onConfirm={() => remove.mutate(show.id, { onSuccess: () => setDeleting(false) })}
                title={t('own.delete.title', { title: show.title })}
                confirmLabel={t('own.delete.action')}
                confirming={remove.isPending}
                error={remove.error}
                errorTitle={t('own.error.delete')}
            >
                {t('own.delete.body')}
            </ConfirmModal>
        </Card>
    );
}

/**
 * Asking a show for an episode: what this one is about, something to read first, and when it airs.
 * Every box is optional for a show with a subject of its own, which is what makes "Wind-down, at
 * eleven" one click and a time.
 */
function EpisodeForm({ show, onDone }: { show: OwnShow; onDone: () => void }) {
    const { t } = useTranslation(['podcasts', 'common']);
    const request = useRequestOwnEpisode();
    const form = useForm({
        mode: 'controlled',
        initialValues: { topic: '', sourceTitle: '', text: '', airAt: null as string | null },
    });

    const submit = (values: typeof form.values) => {
        const scheduledFor = scheduledForOf(values.airAt);
        const body: OwnEpisodeRequest = {
            ...(values.topic.trim().length === 0 ? {} : { topic: values.topic.trim() }),
            ...(values.text.trim().length === 0 ? {} : { text: values.text.trim() }),
            ...(values.sourceTitle.trim().length === 0 || values.text.trim().length === 0 ? {} : { sourceTitle: values.sourceTitle.trim() }),
            ...(scheduledFor === undefined ? {} : { airAt: scheduledFor }),
        };
        request.mutate(
            { showId: show.id, body },
            {
                onSuccess: production => {
                    notifyQueued(t('own.episode.queued', { title: production.title }));
                    onDone();
                },
            },
        );
    };

    return (
        <form onSubmit={form.onSubmit(submit)}>
            <Stack gap="sm">
                {request.error ? <ErrorAlert title={t('own.error.episode')} error={request.error} /> : undefined}
                <Textarea
                    label={t('own.episode.topic.label')}
                    description={show.subject === undefined ? t('own.episode.topic.required') : t('own.episode.topic.description')}
                    autosize
                    minRows={2}
                    {...form.getInputProps('topic')}
                />
                <TextInput
                    label={t('own.episode.sourceTitle')}
                    placeholder={t('own.episode.sourceTitlePlaceholder')}
                    {...form.getInputProps('sourceTitle')}
                />
                <Textarea
                    label={t('own.episode.text.label')}
                    description={t('own.episode.text.description')}
                    autosize
                    minRows={3}
                    maxRows={12}
                    {...form.getInputProps('text')}
                />
                <DateTimePicker
                    label={t('own.episode.airAt.label')}
                    description={t('own.episode.airAt.description')}
                    placeholder={t('own.episode.airAt.placeholder')}
                    valueFormat="ddd D MMM, HH:mm"
                    minDate={new Date()}
                    clearable
                    {...form.getInputProps('airAt')}
                />
                <Group justify="flex-end">
                    <Button variant="subtle" onClick={onDone} disabled={request.isPending}>
                        {t('common:action.cancel')}
                    </Button>
                    <Button type="submit" loading={request.isPending}>
                        {t('own.episode.submit')}
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}

/** A show's latest episodes, with how far along each is, in the Productions page's own words. */
function Episodes({ showId }: { showId: string }) {
    const { t } = useTranslation(['podcasts', 'productions']);
    const episodes = useOwnShowEpisodes(showId);
    const listed = (episodes.data?.productions ?? []).slice(0, EPISODES_SHOWN);

    if (episodes.error) return <ErrorAlert title={t('own.error.episodes')} error={episodes.error} />;
    if (listed.length === 0) return undefined;

    return (
        <Stack gap={4}>
            {listed.map(episode => (
                <Group key={episode.id} gap="xs" wrap="nowrap">
                    {/* Never squeezed: the state is the half of the row that matters, and a long
                        title in a row that will not wrap took it down to its first three letters. */}
                    <Badge variant="light" color={toneColor[toneOf(episode.state)]} style={{ flexShrink: 0 }}>
                        {t(`productions:state.${episode.state}`)}
                    </Badge>
                    <Text size="sm" truncate>
                        {episode.title}
                    </Text>
                    <AirsLine episode={episode} />
                </Group>
            ))}
        </Stack>
    );
}

/** When an episode airs, for one still waiting for its time, and why one failed. */
function AirsLine({ episode }: { episode: Production }) {
    const { t } = useTranslation('podcasts');
    if (episode.state === 'failed' && episode.error !== undefined) {
        return (
            <Text size="xs" c="dimmed" truncate>
                {episode.error}
            </Text>
        );
    }
    if (episode.scheduledFor !== undefined && episode.state !== 'aired' && episode.state !== 'cancelled') {
        return (
            <Text size="xs" c="dimmed">
                {t('own.episode.airs', { when: formatMomentMinute(episode.scheduledFor, { weekday: true }) })}
            </Text>
        );
    }
    return undefined;
}

/** Creating or editing a show. Creating offers the two starting points. */
function ShowForm({
    initial,
    templates = false,
    pending,
    error,
    onSubmit,
    onCancel,
}: {
    initial?: OwnShow;
    templates?: boolean;
    pending: boolean;
    error: unknown;
    onSubmit: (body: OwnShowInput) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation(['podcasts', 'productions', 'common']);
    const personas = usePersonas();
    const form = useForm<ShowValues>({
        mode: 'controlled',
        initialValues: {
            title: initial?.title ?? '',
            description: initial?.description ?? '',
            subject: initial?.subject ?? '',
            personaId: initial?.personaId ?? null,
            minutes: initial?.targetMs === undefined ? '' : Math.round(initial.targetMs / 60_000),
            mode: initial?.writingMode ?? null,
        },
        validate: values => (values.title.trim().length === 0 ? { title: t('own.form.title.required') } : {}),
    });

    const startFrom = (key: keyof typeof TEMPLATES) => {
        const template = TEMPLATES[key];
        form.setValues({
            title: t(`own.template.${key}.title`),
            description: t(`own.template.${key}.description`),
            subject: t(`own.template.${key}.subject`),
            minutes: template.minutes,
            mode: template.mode,
        });
    };

    return (
        <Card withBorder>
            <form onSubmit={form.onSubmit(values => onSubmit(showBodyOf(values)))}>
                <Stack gap="md">
                    {error !== null && error !== undefined ? <ErrorAlert title={t('own.error.save')} error={error} /> : undefined}

                    {templates ? (
                        <Group gap="xs">
                            <Text size="sm" c="dimmed">
                                {t('own.template.label')}
                            </Text>
                            <Button size="compact-sm" variant="light" onClick={() => startFrom('windDown')}>
                                {t('own.template.windDown.title')}
                            </Button>
                            <Button size="compact-sm" variant="light" onClick={() => startFrom('newsInDepth')}>
                                {t('own.template.newsInDepth.title')}
                            </Button>
                        </Group>
                    ) : undefined}

                    <TextInput label={t('own.form.title.label')} withAsterisk {...form.getInputProps('title')} />
                    <TextInput
                        label={t('own.form.description.label')}
                        description={t('own.form.description.description')}
                        {...form.getInputProps('description')}
                    />
                    <Textarea
                        label={t('own.form.subject.label')}
                        description={t('own.form.subject.description')}
                        autosize
                        minRows={2}
                        {...form.getInputProps('subject')}
                    />
                    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                        <Select
                            label={t('productions:form.presenter.label')}
                            data={(personas.data?.personas ?? []).filter(presents).map(persona => ({ value: persona.id, label: persona.label }))}
                            clearable
                            searchable
                            {...form.getInputProps('personaId')}
                        />
                        <NumberInput label={t('productions:form.minutes.label')} min={1} max={120} {...form.getInputProps('minutes')} />
                        <Select
                            label={t('productions:form.mode.label')}
                            data={MODES.map(value => ({ value, label: t(`productions:form.mode.option.${value}`) }))}
                            clearable
                            {...form.getInputProps('mode')}
                        />
                    </SimpleGrid>

                    <Group justify="flex-end">
                        <Button variant="subtle" onClick={onCancel} disabled={pending}>
                            {t('common:action.cancel')}
                        </Button>
                        <Button type="submit" loading={pending}>
                            {initial === undefined ? t('own.form.create') : t('own.form.save')}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Card>
    );
}
