/** The News page: the stories a bulletin is written from, and the two filters over them. */
export const news = {
    title: 'News',
    description:
        'What the station has to talk about, newest first. These are the stories a bulletin is written from; what it actually said is on the scripts page.',
    error: {
        title: 'The news could not be read',
        fallback: 'No plugin answered with a feed.',
    },
    empty: {
        feeds: {
            title: 'No plugin offers a feed',
            body: 'News arrives with a plugin that reads one. Enable one that declares the <code>news</code> capability and add a feed to its settings.',
        },
        filtered:
            'Nothing matches that filter. A category claims the stories of the feeds it was given, so a category with no feed under it has nothing to show.',
        stories: 'The feeds answered with no stories. That is an ordinary state for a slow newsroom rather than a fault.',
    },
    filter: {
        feed: {
            label: 'Feed',
            every: 'Every feed',
        },
        category: {
            label: 'Category',
            description: 'What the operator called the feed',
            every: 'Every category',
        },
    },
    story: {
        source: 'Read it at the source',
    },
} as const;
