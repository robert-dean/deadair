import { useState, type FormEvent } from 'react';
import { Anchor, Badge, Button, Card, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import type { StationDirectoryEntry, StationEpisode } from '@deadair/sdk';
import { Trans, useTranslation } from 'react-i18next';

import {
    useFetchEpisode,
    usePodcastDirectory,
    usePodcastEpisodes,
    usePodcastShows,
    useRefreshPodcasts,
    useSubscribePodcast,
} from '../../api/podcast.queries';
import { i18n } from '../../i18n/i18n.setup';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { formatDuration } from '../shared/format.duration';
import { formatMomentMinute } from '../shared/feed.moment';
import { notifyQueued } from '../shared/notify';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { severityColor, type StatusTone } from '../shared/status';
import { StatusLamp } from '../shared/status.lamp';

/** The show filter at rest. */
const EVERY_SHOW = 'all';

/**
 * How long after asking the station counts a fetch as still going.
 *
 * The station's own window before it would ask again (`FETCH_RETRY_AFTER_MS`, twenty minutes), so the
 * page says "fetching" for exactly as long as the station would refuse to start a second one.
 */
const FETCHING_FOR_MS = 20 * 60_000;

/**
 * Somebody else's programmes: the shows the station carries, the episodes of them it knows about, and
 * what it has done with each.
 *
 * An episode airs when a `syndicated` band on the format clock names its show, and this page is where
 * an operator sees whether that is going to work: whether tonight's episode has arrived in the feed,
 * whether the station has its audio yet, and whether it aired. A fetch can be asked for here ahead of
 * the clock, which is also how a fetch that failed is tried again.
 *
 * The shows come from the plugins, which read every subscribed feed to answer, so they are the slow
 * half of the page; the episodes are the station's own table and answer at once.
 */
export function PodcastsPage() {
    const { t } = useTranslation('podcasts');
    const shows = usePodcastShows();
    const [showId, setShowId] = useState<string>(EVERY_SHOW);
    const episodes = usePodcastEpisodes(showId === EVERY_SHOW ? undefined : showId);
    const refresh = useRefreshPodcasts();
    const fetchEpisode = useFetchEpisode();

    const carried = shows.data?.shows ?? [];
    const listed = episodes.data?.episodes ?? [];

    return (
        <Stack gap="lg">
            <PageHeader
                title={t('title')}
                description={
                    <Text size="sm" c="dimmed">
                        <Trans t={t} i18nKey="description" components={{ code: <code /> }} />
                    </Text>
                }
                actions={
                    <Button
                        size="xs"
                        variant="default"
                        loading={refresh.isPending}
                        onClick={() =>
                            refresh.mutate(undefined, {
                                onSuccess: () => notifyQueued(t('refresh.queued')),
                            })
                        }
                    >
                        {t('refresh.action')}
                    </Button>
                }
            />

            {shows.error ? <ErrorAlert title={t('error.shows')} error={shows.error} fallback={t('error.showsFallback')} /> : undefined}
            {episodes.error ? <ErrorAlert title={t('error.episodes')} error={episodes.error} /> : undefined}
            {refresh.error ? <ErrorAlert title={t('error.refresh')} error={refresh.error} /> : undefined}
            {fetchEpisode.error ? <ErrorAlert title={t('error.fetch')} error={fetchEpisode.error} /> : undefined}

            {episodes.isPending ? <PageSkeleton variant="rows" count={4} /> : undefined}

            {shows.data && carried.length === 0 ? <EmptyState title={t('empty.shows.title')}>{t('empty.shows.body')}</EmptyState> : undefined}

            {carried.length > 0 ? (
                <Select
                    size="xs"
                    w={{ base: '100%', sm: 320 }}
                    label={t('filter.label')}
                    data={[{ value: EVERY_SHOW, label: t('filter.every') }, ...carried.map(show => ({ value: show.id, label: show.title }))]}
                    value={showId}
                    allowDeselect={false}
                    onChange={next => {
                        if (next !== null) setShowId(next);
                    }}
                />
            ) : undefined}

            {episodes.data && carried.length > 0 && listed.length === 0 ? <EmptyState>{t('empty.episodes')}</EmptyState> : undefined}

            {listed.length > 0 ? (
                <Stack gap="xs">
                    {listed.map(episode => (
                        <Episode
                            key={episode.id}
                            episode={episode}
                            asking={fetchEpisode.isPending && fetchEpisode.variables === episode.id}
                            onFetch={() =>
                                fetchEpisode.mutate(episode.id, {
                                    onSuccess: () => notifyQueued(t('episode.queued', { title: episode.title })),
                                })
                            }
                        />
                    ))}
                </Stack>
            ) : undefined}

            <Directory carried={new Set(carried.flatMap(show => (show.feedUrl === undefined ? [] : [show.feedUrl])))} />
        </Stack>
    );
}

/**
 * What the station has done with an episode, in one word and the console's own tone for it.
 *
 * A fetch that failed is a `fault` rather than anything red: the station is still working, and on this
 * desk red is the transmitter. Waiting on a fetch is `standby`, the tone for waiting.
 */
export function episodeState(episode: StationEpisode, now = Date.now()): { label: string; tone: StatusTone } {
    const { state, tone } = episodeStateKey(episode, now);
    return { label: i18n.t(`podcasts:state.${state}`), tone };
}

type EpisodeStateKey = 'aired' | 'ready' | 'fetching' | 'failed' | 'unfetched';

/** {@link episodeState} before it is put into words, so a caller can ask which state it is without comparing copy. */
function episodeStateKey(episode: StationEpisode, now = Date.now()): { state: EpisodeStateKey; tone: StatusTone } {
    if (episode.airedAt !== undefined) return { state: 'aired', tone: 'off' };
    if (episode.fetched) return { state: 'ready', tone: 'ok' };

    const asked = episode.fetchRequestedAt === undefined ? undefined : Date.parse(episode.fetchRequestedAt);
    if (asked !== undefined && now - asked < FETCHING_FOR_MS) return { state: 'fetching', tone: 'standby' };
    if (episode.fetchError !== undefined) return { state: 'failed', tone: 'fault' };

    return { state: 'unfetched', tone: 'off' };
}

/** One episode, with what the station has done with it and a way to ask for its audio. */
function Episode({ episode, asking, onFetch }: { episode: StationEpisode; asking: boolean; onFetch: () => void }) {
    const { t } = useTranslation(['podcasts', 'common']);
    const { state: key, tone } = episodeStateKey(episode);
    const state = { label: t(`state.${key}`), tone };
    const canFetch = !episode.fetched && key !== 'fetching';

    return (
        <Card padding="md">
            <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
                <Stack gap="xxs" style={{ minWidth: 0 }}>
                    <Group gap="xs" wrap="wrap">
                        <Badge size="xs" variant="light" color="gray" tt="none">
                            {episode.showTitle}
                        </Badge>
                        <StatusLamp tone={state.tone} label={state.label} />
                        {episode.explicit === true ? (
                            <Badge size="xs" variant="outline" color="gray" tt="none">
                                {t('episode.explicit')}
                            </Badge>
                        ) : undefined}
                        {episode.publishedAt === undefined ? undefined : (
                            <Text size="xs" c="dimmed" className="da-num">
                                {formatMomentMinute(episode.publishedAt)}
                            </Text>
                        )}
                        {episode.durationMs === undefined ? undefined : (
                            <Text size="xs" c="dimmed" className="da-num">
                                {formatDuration(episode.durationMs)}
                            </Text>
                        )}
                    </Group>

                    <Text size="sm" fw={600}>
                        {episode.title}
                    </Text>

                    {episode.summary === undefined ? undefined : (
                        <Text size="sm" c="dimmed" lineClamp={3}>
                            {episode.summary}
                        </Text>
                    )}

                    {episode.airedAt !== undefined ? (
                        <Text size="xs" c="dimmed">
                            {t('episode.airedAt', { when: formatMomentMinute(episode.airedAt, { weekday: true }) })}
                        </Text>
                    ) : episode.scheduledFor !== undefined ? (
                        <Text size="xs" c="dimmed">
                            {t('episode.wantedFor', { when: formatMomentMinute(episode.scheduledFor, { weekday: true }) })}
                        </Text>
                    ) : undefined}

                    {episode.fetchError !== undefined && !episode.fetched ? (
                        <Text size="xs" c={severityColor.warning}>
                            {t('episode.failed', { error: episode.fetchError })}
                        </Text>
                    ) : undefined}

                    {episode.url === undefined ? undefined : (
                        <Anchor href={episode.url} target="_blank" rel="noreferrer noopener" size="xs">
                            {t('episode.page')}
                        </Anchor>
                    )}
                </Stack>

                {canFetch ? (
                    <Button size="xs" variant="default" loading={asking} onClick={onFetch} style={{ flexShrink: 0 }}>
                        {episode.fetchError === undefined ? t('episode.fetch') : t('common:action.tryAgain')}
                    </Button>
                ) : undefined}
            </Group>
        </Card>
    );
}

/**
 * Finding a show to subscribe to.
 *
 * Nothing is sent until somebody presses search, because the words go to somebody else's directory.
 * A result the station already carries says so instead of offering to subscribe again.
 */
function Directory({ carried }: { carried: ReadonlySet<string> }) {
    const { t } = useTranslation('podcasts');
    const [typed, setTyped] = useState('');
    const [searched, setSearched] = useState('');
    const directory = usePodcastDirectory(searched);
    const subscribe = useSubscribePodcast();

    const submit = (event: FormEvent) => {
        event.preventDefault();
        setSearched(typed.trim());
    };

    const results = directory.data?.results ?? [];

    return (
        <Stack gap="sm">
            <Text fw={600}>{t('directory.title')}</Text>
            <form onSubmit={submit}>
                <Group gap="xs" align="flex-end" wrap="wrap">
                    <TextInput
                        size="xs"
                        w={{ base: '100%', sm: 320 }}
                        label={t('directory.label')}
                        description={t('directory.description')}
                        value={typed}
                        onChange={event => setTyped(event.currentTarget.value)}
                    />
                    <Button size="xs" type="submit" variant="default" loading={directory.isFetching} disabled={typed.trim().length === 0}>
                        {t('directory.search')}
                    </Button>
                </Group>
            </form>

            {directory.error ? <ErrorAlert title={t('directory.error')} error={directory.error} /> : undefined}
            {subscribe.error ? <ErrorAlert title={t('directory.subscribeError')} error={subscribe.error} /> : undefined}

            {directory.data && results.length === 0 ? <EmptyState>{t('directory.empty')}</EmptyState> : undefined}

            {results.length > 0 ? (
                <Stack gap="xs">
                    {results.map(entry => (
                        <DirectoryResult
                            key={`${entry.pluginId}:${entry.id}`}
                            entry={entry}
                            subscribed={carried.has(entry.feedUrl)}
                            subscribing={subscribe.isPending && subscribe.variables?.feedUrl === entry.feedUrl}
                            onSubscribe={() =>
                                subscribe.mutate(entry, {
                                    onSuccess: () => notifyQueued(t('directory.subscribed', { title: entry.title })),
                                })
                            }
                        />
                    ))}
                </Stack>
            ) : undefined}
        </Stack>
    );
}

function DirectoryResult({
    entry,
    subscribed,
    subscribing,
    onSubscribe,
}: {
    entry: StationDirectoryEntry;
    subscribed: boolean;
    subscribing: boolean;
    onSubscribe: () => void;
}) {
    const { t } = useTranslation('podcasts');
    return (
        <Card padding="sm">
            <Group justify="space-between" align="center" wrap="nowrap" gap="md">
                <Stack gap={2} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600}>
                        {entry.title}
                    </Text>
                    {entry.author === undefined ? undefined : (
                        <Text size="xs" c="dimmed">
                            {entry.author}
                        </Text>
                    )}
                    <Text size="xs" c="dimmed" truncate>
                        {entry.feedUrl}
                    </Text>
                </Stack>
                {subscribed ? (
                    <StatusLamp tone="ok" label={t('directory.subscribedLamp')} />
                ) : (
                    <Button size="xs" variant="default" loading={subscribing} onClick={onSubscribe} style={{ flexShrink: 0 }}>
                        {t('directory.subscribe')}
                    </Button>
                )}
            </Group>
        </Card>
    );
}
