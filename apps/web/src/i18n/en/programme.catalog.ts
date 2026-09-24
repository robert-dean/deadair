/**
 * The fields that describe a broadcast, shared by the slot editor, the sustaining panel and the
 * desk's briefing box, so each label and paragraph exists once.
 */
export const programme = {
    source: {
        label: 'Playing from',
        description: 'Leave it empty for a broadcast the station fills itself.',
        option: '{{name}} — {{from}}',
        groupStation: 'The station’s playlists',
        groupPlaylists: 'Playlists',
        groupProviders: 'From the providers',
        groupCharts: 'Charts',
        clear: 'Play from no playlist or chart',
        reading: 'Reading the plugins…',
        nothing: 'Nothing on offer',
    },
    chartOrder: {
        label: 'Played',
        description: 'A countdown ends on number one, which is the shape a chart show has.',
        countdown: 'Countdown, ending on number one',
        ranked: 'Number one first',
        unordered: 'No fixed order',
    },
    host: {
        label: 'Hosted by',
        description: 'Empty means the station’s own host.',
        onAir: '{{label}} (on air)',
    },
    brief: {
        label: 'Asked to play',
        description:
            'In your own words, for the model that chooses records. Leave it empty and the station plays its ordinary rotation. The host only presents.',
        placeholder: 'warm and unhurried',
    },
    era: {
        fromLabel: 'From year',
        fromDescription: 'Empty means no lower bound.',
        toLabel: 'To year',
        toDescription: 'Empty means no upper bound.',
        note: 'A record whose release year the catalogue does not know is played whatever the period. Leaving it out is not evidence of the wrong decade, and demanding one would empty the draw on a library nothing has enriched.',
    },
    shape: {
        modeLabel: 'Mode',
        mode: {
            rotation: 'Rotation',
            setlist: 'Setlist',
            feature: 'Feature',
        },
        onEndLabel: 'When it runs out',
        onEnd: {
            extend: 'Keep going',
            repeat: 'Start again',
            stop: 'Stop',
        },
        note: {
            broadcast:
                'Starting again replays what this broadcast already aired. It never reaches further than that: a record you disliked stays off the air whether the broadcast is running for the first time or the fifth.',
            block: 'Starting again replays what this block already aired. It never reaches further than that: a record you disliked stays off the air whether the block is running for the first time or the fifth.',
        },
    },
    callins: {
        label: 'Take calls during this broadcast',
        description:
            'A phone-in is written and spoken a turn at a time, so it lands minutes after it is asked for. A setlist or a feature takes none whatever this says.',
    },
    mixInSimilar: {
        label: 'Mix in similar records',
        description:
            'Every few records, one by an artist who sounds like the one just played, found through a similarity plugin. The playlist still plays in full around them. A setlist or a feature never has anything mixed in.',
    },
} as const;
