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
        events: 'Event destinations',
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
    asRun: {
        title: 'As run',
        description:
            'What actually went out, newest first: every record, break and programme with when it started and how long it ran, and between them any stretch the station aired its local bed or was off air.',
        failure: 'The as-run log could not be read.',
        empty: {
            all: 'Nothing has gone out yet. The log starts with the first item that airs.',
            before: 'Nothing had gone out by then.',
        },
        until: {
            label: 'Read back from',
            placeholder: 'Now',
        },
        kind: {
            record: 'Record',
            break: 'Break',
            programme: 'Programme',
            gap: 'Local bed',
            onAir: 'On air',
            offAir: 'Off air',
        },
        by: 'by {{artists}}',
        passedOver_one: 'The player moved past {{count}} item that had been handed over to reach this one. It never aired.',
        passedOver_other: 'The player moved past {{count}} items that had been handed over to reach this one. They never aired.',
        onAirNow: 'on air',
        noEnd: 'no end seen',
    },
} as const;
