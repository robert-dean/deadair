/** Podcasts: the shows the station carries, their episodes, and the directory a show is found in. */
export const podcasts = {
    title: 'Podcasts',
    /** The shows the station makes for itself, above the ones it carries. */
    own: {
        title: 'Your shows',
        description:
            'Shows the station makes for itself. Each episode is written and spoken by the station, and airs as soon as it is made or at the time you give it.',
        create: 'New show',
        edit: 'Edit',
        empty: 'No shows of your own yet. Start one from a template: something to fall asleep to, or the day’s news taken slowly.',
        about: 'About: {{subject}}',
        noSubject: 'No standing subject, so each episode needs a topic or something to read.',
        readsNews_one: 'Reads the news on {{count}} feed from the last {{hours}} hours.',
        readsNews_other: 'Reads the news on {{count}} feeds from the last {{hours}} hours.',
        error: {
            list: 'Your shows could not be read',
            save: 'That show could not be saved',
            delete: 'That show could not be deleted',
            episode: 'That episode could not be asked for',
            episodes: 'This show’s episodes could not be read',
        },
        delete: {
            action: 'Delete',
            title: 'Delete {{title}}?',
            body: 'Its episodes stay on the Productions page, and any still being made carry on. Only the show goes.',
        },
        form: {
            title: { label: 'Called', required: 'Give it a name' },
            description: { label: 'What it is', description: 'For you, on this page. Never read out.' },
            subject: {
                label: 'What it is about',
                description: 'What an episode is about when you ask for one without a topic of its own. This is what it is planned from.',
            },
            news: {
                label: 'News it reads',
                description:
                    'For a show about the day’s stories. Each episode reads the newest on these feeds and states only what it finds in them.',
            },
            newsHours: { label: 'Hours back', description: 'Leave empty for a day.' },
            create: 'Make the show',
            save: 'Save',
        },
        template: {
            label: 'Start from',
            windDown: {
                title: 'Wind-down',
                description: 'Something to fall asleep to.',
                subject:
                    'Something calm and quietly interesting to fall asleep to: one subject taken slowly, with nothing alarming, no news and no sudden turns.',
            },
            newsInDepth: {
                title: 'News in depth',
                description: 'The day’s news, taken slowly.',
                subject: 'The day’s news in depth: a few stories explained properly, with what led up to them, rather than many read out.',
            },
        },
        episode: {
            ask: 'Make an episode',
            submit: 'Make it',
            queued: '"{{title}}" is queued. It is written and spoken over the next few minutes, and appears below as it goes.',
            airs: 'airs {{when}}',
            topic: {
                label: 'What this one is about',
                description: 'Leave empty for the show’s own subject.',
                required: 'This show has no subject of its own, so give it one here or something to read below.',
            },
            url: {
                label: 'A page to read first',
                description: 'The station reads it and states as fact only what it finds there.',
                placeholder: 'https://',
            },
            sourceTitle: 'What the text is called',
            sourceTitlePlaceholder: 'An article, a chapter, your own notes',
            text: {
                label: 'Something to read first',
                description: 'Paste an article or notes. The episode states as fact only what it can find in this.',
            },
            airAt: {
                label: 'Air at',
                description: 'Leave empty to air it as soon as it is made.',
                placeholder: 'As soon as it is ready',
            },
        },
    },
    description:
        "Shows the station makes for itself, and somebody else's programmes it can carry, newest first. A <code>syndicated</code> band on the format clock airs a carried show's newest episode at its time; the station fetches the audio a few hours before.",
    refresh: {
        action: 'Read the feeds now',
        queued: 'The station is reading every feed again. New episodes appear here in a minute or two.',
    },
    error: {
        shows: 'The shows could not be read',
        showsFallback: 'No podcast plugin answered.',
        episodes: 'The episodes could not be read',
        refresh: 'The feeds could not be read again',
        fetch: 'That episode could not be asked for',
    },
    empty: {
        shows: {
            title: 'The station carries no shows yet',
            body: "Look one up below and subscribe, or add a feed address on the Podcasts plugin's settings page. A show's episodes arrive here once its feed has been read.",
        },
        episodes: 'The station has read no episodes yet. The feeds are read every half hour; read them now to see what they carry.',
    },
    filter: {
        label: 'Show',
        every: 'Every show',
    },
    state: {
        aired: 'Aired',
        ready: 'Ready to air',
        fetching: 'Fetching',
        failed: 'Could not fetch',
        unfetched: 'Not fetched',
    },
    episode: {
        explicit: 'Explicit',
        airedAt: 'Aired {{when}}.',
        wantedFor: 'Wanted for {{when}}.',
        failed: 'The last attempt failed: {{error}}.',
        page: "The episode's page",
        fetch: 'Fetch now',
        queued: 'Fetching {{title}}. It is ready to air once it arrives.',
    },
    directory: {
        title: 'Find a show',
        label: 'Show, publisher or subject',
        description: 'Searched in the directory the Podcasts plugin uses. What you type is sent to it.',
        search: 'Search',
        error: 'The directory could not be searched',
        subscribeError: 'That show could not be subscribed to',
        empty: "Nothing in the directory matches that. A show's exact name usually finds it.",
        subscribed: 'Subscribed to {{title}}. Its episodes appear here once its feed has been read.',
        subscribedLamp: 'Subscribed',
        subscribe: 'Subscribe',
    },
} as const;
