/** The Charts page: what the rest of the world is playing, as the installed plugins report it. */
export const charts = {
    page: {
        title: 'Charts',
        description:
            'What the rest of the world is playing, as the installed plugins report it. Airing one puts the station on those records for a broadcast; when they run out it programmes itself again as usual.',
        readFailedTitle: 'The charts could not be read',
        readFailedFallback: 'No plugin answered with a chart.',
        noneTitle: 'No plugin offers a chart',
        none: 'A chart arrives with a plugin that publishes one. Enable one that declares the <code>charts</code> capability and its charts appear here.',
        pickerLabel: 'Chart',
        chartFailedTitle: 'That chart could not be read',
        chartFailedFallback: 'The plugin did not answer.',
        emptyTitle: 'Nothing in this edition',
        empty: 'The plugin answered with no records. That is an ordinary state for a chart that has not published yet today.',
    },
    record: {
        featuring: 'feat. {{names}}',
        peak: 'peak {{peak}}',
        weeks: '{{weeks}} wks',
        findInCatalog: 'Find in catalog',
    },
    column: {
        title: 'Title',
        artist: 'Artist',
        album: 'Album',
        peak: 'Peak',
        weeks: 'Weeks',
    },
} as const;
