/** Podcasts: the shows the station carries, their episodes, and the directory a show is found in. */
export const podcasts = {
    title: 'Podcasts',
    description:
        "Somebody else's programmes the station can carry, newest first. A <code>syndicated</code> band on the format clock airs a show's newest episode at its time; the station fetches the audio a few hours before.",
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
