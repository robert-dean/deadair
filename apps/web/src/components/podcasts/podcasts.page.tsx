import { useState, type FormEvent } from 'react';
import { Anchor, Badge, Button, Card, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import type { StationDirectoryEntry, StationEpisode } from '@deadair/sdk';

import {
    useFetchEpisode,
    usePodcastDirectory,
    usePodcastEpisodes,
    usePodcastShows,
    useRefreshPodcasts,
    useSubscribePodcast,
} from '../../api/podcast.queries';
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
                title="Podcasts"
                description={
                    <Text size="sm" c="dimmed">
                        Somebody else&apos;s programmes the station can carry, newest first. A <code>syndicated</code> band on the format clock airs a
                        show&apos;s newest episode at its time; the station fetches the audio a few hours before.
                    </Text>
                }
                actions={
                    <Button
                        size="xs"
                        variant="default"
                        loading={refresh.isPending}
                        onClick={() =>
                            refresh.mutate(undefined, {
                                onSuccess: () =>
                                    notifyQueued('The station is reading every feed again. New episodes appear here in a minute or two.'),
                            })
                        }
                    >
                        Read the feeds now
                    </Button>
                }
            />

            {shows.error ? <ErrorAlert title="The shows could not be read" error={shows.error} fallback="No podcast plugin answered." /> : undefined}
            {episodes.error ? <ErrorAlert title="The episodes could not be read" error={episodes.error} /> : undefined}
            {refresh.error ? <ErrorAlert title="The feeds could not be read again" error={refresh.error} /> : undefined}
            {fetchEpisode.error ? <ErrorAlert title="That episode could not be asked for" error={fetchEpisode.error} /> : undefined}

            {episodes.isPending ? <PageSkeleton variant="rows" count={4} /> : undefined}

            {shows.data && carried.length === 0 ? (
                <EmptyState title="The station carries no shows yet">
                    Look one up below and subscribe, or add a feed address on the Podcasts plugin&apos;s settings page. A show&apos;s episodes arrive
                    here once its feed has been read.
                </EmptyState>
            ) : undefined}

            {carried.length > 0 ? (
                <Select
                    size="xs"
                    w={{ base: '100%', sm: 320 }}
                    label="Show"
                    data={[{ value: EVERY_SHOW, label: 'Every show' }, ...carried.map(show => ({ value: show.id, label: show.title }))]}
                    value={showId}
                    allowDeselect={false}
                    onChange={next => {
                        if (next !== null) setShowId(next);
                    }}
                />
            ) : undefined}

            {episodes.data && carried.length > 0 && listed.length === 0 ? (
                <EmptyState>
                    The station has read no episodes yet. The feeds are read every half hour; read them now to see what they carry.
                </EmptyState>
            ) : undefined}

            {listed.length > 0 ? (
                <Stack gap="xs">
                    {listed.map(episode => (
                        <Episode
                            key={episode.id}
                            episode={episode}
                            asking={fetchEpisode.isPending && fetchEpisode.variables === episode.id}
                            onFetch={() =>
                                fetchEpisode.mutate(episode.id, {
                                    onSuccess: () => notifyQueued(`Fetching ${episode.title}. It is ready to air once it arrives.`),
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
    if (episode.airedAt !== undefined) return { label: 'Aired', tone: 'off' };
    if (episode.fetched) return { label: 'Ready to air', tone: 'ok' };

    const asked = episode.fetchRequestedAt === undefined ? undefined : Date.parse(episode.fetchRequestedAt);
    if (asked !== undefined && now - asked < FETCHING_FOR_MS) return { label: 'Fetching', tone: 'standby' };
    if (episode.fetchError !== undefined) return { label: 'Could not fetch', tone: 'fault' };

    return { label: 'Not fetched', tone: 'off' };
}

/** One episode, with what the station has done with it and a way to ask for its audio. */
function Episode({ episode, asking, onFetch }: { episode: StationEpisode; asking: boolean; onFetch: () => void }) {
    const state = episodeState(episode);
    const canFetch = !episode.fetched && state.label !== 'Fetching';

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
                                Explicit
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
                            Aired {formatMomentMinute(episode.airedAt, { weekday: true })}.
                        </Text>
                    ) : episode.scheduledFor !== undefined ? (
                        <Text size="xs" c="dimmed">
                            Wanted for {formatMomentMinute(episode.scheduledFor, { weekday: true })}.
                        </Text>
                    ) : undefined}

                    {episode.fetchError !== undefined && !episode.fetched ? (
                        <Text size="xs" c={severityColor.warning}>
                            The last attempt failed: {episode.fetchError}.
                        </Text>
                    ) : undefined}

                    {episode.url === undefined ? undefined : (
                        <Anchor href={episode.url} target="_blank" rel="noreferrer noopener" size="xs">
                            The episode&apos;s page
                        </Anchor>
                    )}
                </Stack>

                {canFetch ? (
                    <Button size="xs" variant="default" loading={asking} onClick={onFetch} style={{ flexShrink: 0 }}>
                        {episode.fetchError === undefined ? 'Fetch now' : 'Try again'}
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
            <Text fw={600}>Find a show</Text>
            <form onSubmit={submit}>
                <Group gap="xs" align="flex-end" wrap="wrap">
                    <TextInput
                        size="xs"
                        w={{ base: '100%', sm: 320 }}
                        label="Show, publisher or subject"
                        description="Searched in the directory the Podcasts plugin uses. What you type is sent to it."
                        value={typed}
                        onChange={event => setTyped(event.currentTarget.value)}
                    />
                    <Button size="xs" type="submit" variant="default" loading={directory.isFetching} disabled={typed.trim().length === 0}>
                        Search
                    </Button>
                </Group>
            </form>

            {directory.error ? <ErrorAlert title="The directory could not be searched" error={directory.error} /> : undefined}
            {subscribe.error ? <ErrorAlert title="That show could not be subscribed to" error={subscribe.error} /> : undefined}

            {directory.data && results.length === 0 ? (
                <EmptyState>Nothing in the directory matches that. A show&apos;s exact name usually finds it.</EmptyState>
            ) : undefined}

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
                                    onSuccess: () =>
                                        notifyQueued(`Subscribed to ${entry.title}. Its episodes appear here once its feed has been read.`),
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
                    <StatusLamp tone="ok" label="Subscribed" />
                ) : (
                    <Button size="xs" variant="default" loading={subscribing} onClick={onSubscribe} style={{ flexShrink: 0 }}>
                        Subscribe
                    </Button>
                )}
            </Group>
        </Card>
    );
}
