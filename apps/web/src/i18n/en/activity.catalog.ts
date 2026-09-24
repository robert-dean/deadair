/** The activity feed: its filters, its empty states and the links off a line. */
export const activity = {
    title: 'Activity',
    description: 'What the station has done, newest first: what aired, what it wrote and spoke, and every moment a gate opened or closed on it.',
    failure: 'The activity feed could not be read.',
    empty: {
        all: 'Nothing yet. The station writes here as it airs records, makes breaks and changes what it is doing.',
        filtered: 'Nothing matches that filter.',
    },
    module: {
        all: 'Everything',
        playout: 'Playout',
        director: 'Programming',
        render: 'Breaks',
        catalog: 'Catalog',
        plugins: 'Plugins',
        storage: 'Storage',
    },
    severity: {
        all: 'All',
        warn: 'Warnings',
        fault: 'Faults',
    },
    line: {
        script: 'what was said',
        track: 'the record',
    },
} as const;
