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
        description:
            'A countdown ends on number one, which is the shape a chart show has. The chart is cut to what fits in the block, keeping the top, so a one-hour block is a shorter countdown than a five-hour one.',
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
    mood: {
        label: 'Leans toward',
        description:
            'Records a model has judged to be in this mood are a little more likely to be picked. Nothing is ever kept off the air for it, and it does nothing until moods are switched on under Words.',
        stagesDescription:
            'The slot leans into each mood in turn, for an equal share of its time: the first while it opens, the last as it closes. Records a model has judged to be in the mood are a little more likely to be picked, and nothing is ever kept off the air for it.',
        none: 'No lean',
        then: 'Then…',
        stage: 'Mood stage {{number}}',
        clearStage: 'Remove mood stage {{number}}',
        options: {
            love: 'Love',
            happiness: 'Happiness',
            comfort: 'Comfort',
            sadness: 'Sadness',
            loneliness: 'Loneliness',
            anger: 'Anger',
            fear: 'Fear',
        },
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
    talk: {
        label: 'Host talks between records',
        description:
            'For a countdown or any setlist with a presenter. The host talks and the station plays its jingles as often as it usually does, while the records play exactly in this order with nothing cut or added.',
    },
    chartPositions: {
        label: "Say each record's chart position",
        description: 'The host says where the chart placed a record, and its highest position where the chart gives one, when talking about it.',
    },
    mixInSimilar: {
        label: 'Mix in similar records',
        description:
            'Every few records, one by an artist who sounds like the one just played, found through a similarity plugin. The playlist still plays in full around them. A setlist or a feature never has anything mixed in.',
    },
    requestShow: {
        label: 'Request show',
        description:
            'The station plays as it otherwise would until a listener asks for a record. Then what it had planned after the request is replaced by records that sound like it, found through a similarity plugin. A second request waits for the first one’s records to play out.',
        followOnLabel: 'Records after each request',
        followOnDescription: 'How many records like the request follow it before the station goes back to its own choices.',
        cooldownLabel: 'Minutes between one listener’s requests',
        cooldownDescription: 'For this show only. Empty keeps the station’s own setting.',
        maxOpenLabel: 'Requests waiting at once',
        maxOpenDescription: 'For this show only. Empty keeps the station’s own setting.',
    },
} as const;
