import { useState } from 'react';
import { Anchor, Badge, Card, Group, Select, Stack, Text } from '@mantine/core';
import type { NewsStory } from '@deadair/sdk';

import { useNews, useNewsFeeds } from '../../api/news.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { formatMomentMinute } from '../shared/feed.moment';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';

/** Both filters at rest, and the value the two Selects carry when nothing is narrowed. */
const EVERYTHING = 'all';

/**
 * What the station thinks the news is.
 *
 * The first question anybody asks when a bulletin reads oddly, and until now it was answerable only
 * by running a script. `GET /news/feeds` and `GET /news` have both existed with nothing drawing
 * them.
 *
 * It shows the same stories a bulletin would be written from, and deliberately not what was
 * actually READ on air: the log that remembers a headline for twelve hours is in memory and on no
 * contract, because what was reported is already durable in `script_history` and this page is not a
 * second, disagreeing record of it. To see what the station SAID, read `/scripts`.
 *
 * The category filter is applied HERE rather than asked for. A category is what the OPERATOR said
 * about a feed rather than anything the publisher sent, so narrowing by one is a join from stories
 * to the feeds that carry a category, on `feedId` — which is exactly what `NewsService.feedCategories`
 * does server-side for the bulletin, reproduced rather than exposed because it needs nothing the
 * console does not already hold.
 */
export function NewsPage() {
    const feeds = useNewsFeeds();
    const [feedId, setFeedId] = useState<string>(EVERYTHING);
    const [category, setCategory] = useState<string>(EVERYTHING);

    // The feed narrowing is server-side, since the contract takes it and a station with a dozen
    // feeds should not pull all of them to show one.
    const news = useNews(feedId === EVERYTHING ? undefined : feedId);

    const known = feeds.data?.feeds ?? [];
    const categoryOf = new Map(known.filter(feed => feed.category !== undefined).map(feed => [feed.id, feed.category as string]));
    const categories = [...new Set(categoryOf.values())].sort();

    const stories = (news.data?.stories ?? []).filter(story => category === EVERYTHING || categoryOf.get(story.feedId) === category);

    const failure = feeds.error ?? news.error;
    const narrowed = feedId !== EVERYTHING || category !== EVERYTHING;

    return (
        <Stack gap="lg">
            <PageHeader
                title="News"
                description={
                    <Text size="sm" c="dimmed">
                        What the station has to talk about, newest first. These are the stories a bulletin is written from; what it actually said is
                        on the scripts page.
                    </Text>
                }
            />

            {failure ? <ErrorAlert title="The news could not be read" error={failure} fallback="No plugin answered with a feed." /> : undefined}

            {feeds.isPending || news.isPending ? <PageSkeleton variant="rows" count={4} /> : undefined}

            {feeds.data && known.length === 0 ? (
                <EmptyState title="No plugin offers a feed">
                    News arrives with a plugin that reads one. Enable one that declares the <code>news</code> capability and add a feed to its
                    settings.
                </EmptyState>
            ) : undefined}

            {known.length > 0 ? (
                <Group gap="md" wrap="wrap" align="flex-end">
                    <Select
                        size="xs"
                        w={280}
                        label="Feed"
                        data={[{ value: EVERYTHING, label: 'Every feed' }, ...known.map(feed => ({ value: feed.id, label: feed.name }))]}
                        value={feedId}
                        allowDeselect={false}
                        onChange={next => {
                            if (next !== null) setFeedId(next);
                        }}
                    />
                    {/* Only where the operator has actually sorted their feeds. A category menu with
                        one entry is a control that cannot narrow anything. */}
                    {categories.length > 0 ? (
                        <Select
                            size="xs"
                            w={220}
                            label="Category"
                            description="What the operator called the feed"
                            data={[{ value: EVERYTHING, label: 'Every category' }, ...categories.map(one => ({ value: one, label: one }))]}
                            value={category}
                            allowDeselect={false}
                            onChange={next => {
                                if (next !== null) setCategory(next);
                            }}
                        />
                    ) : undefined}
                </Group>
            ) : undefined}

            {news.data && known.length > 0 && stories.length === 0 ? (
                <EmptyState>
                    {narrowed
                        ? 'Nothing matches that filter. A category claims the stories of the feeds it was given, so a category with no feed under it has nothing to show.'
                        : 'The feeds answered with no stories. That is an ordinary state for a slow newsroom rather than a fault.'}
                </EmptyState>
            ) : undefined}

            {stories.length > 0 ? (
                <Stack gap="xs">
                    {stories.map(story => (
                        <Story key={story.id} story={story} category={categoryOf.get(story.feedId)} />
                    ))}
                </Stack>
            ) : undefined}
        </Stack>
    );
}

/**
 * One story, as the station holds it.
 *
 * A plain card rather than the `DatedFeed` every other list here uses, and the reason is the date:
 * `publishedAt` is OPTIONAL on a story, where `DatedFeedItem` requires one. Feeding it a stand-in
 * would put a timestamp the publisher never sent on a row, which on a page about what is true today
 * is exactly the wrong thing to invent.
 */
function Story({ story, category }: { story: NewsStory; category?: string }) {
    return (
        <Card padding="md">
            <Stack gap="xxs">
                <Group gap="xs" wrap="wrap">
                    <Badge size="xs" variant="light" color="gray" tt="none">
                        {story.feedName}
                    </Badge>
                    {/* What the operator filed the feed under, which is the strongest of the three
                        signals a bulletin classifies with and the only one that does not travel
                        with the story. */}
                    {category === undefined ? undefined : (
                        <Badge size="xs" variant="light" color="grape" tt="none">
                            {category}
                        </Badge>
                    )}
                    {/* And what the publisher said it was about, which is a different claim. */}
                    {(story.categories ?? []).map(one => (
                        <Badge key={one} size="xs" variant="outline" color="gray" tt="none">
                            {one}
                        </Badge>
                    ))}
                    {story.publishedAt === undefined ? undefined : (
                        <Text size="xs" c="dimmed" className="da-num">
                            {formatMomentMinute(story.publishedAt)}
                        </Text>
                    )}
                </Group>

                <Text size="sm" fw={600}>
                    {story.title}
                </Text>

                {story.summary === undefined ? undefined : (
                    <Text size="sm" c="dimmed">
                        {story.summary}
                    </Text>
                )}

                {story.url === undefined ? undefined : (
                    <Anchor href={story.url} target="_blank" rel="noreferrer noopener" size="xs">
                        Read it at the source
                    </Anchor>
                )}
            </Stack>
        </Card>
    );
}
