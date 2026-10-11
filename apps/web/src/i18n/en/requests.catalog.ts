/** Listener requests: what listeners asked for, and the operator's decision on it. */
export const requests = {
    forbidden: 'Listener requests are for the station’s operators to decide on.',
    description: 'Records listeners asked for, from an app or a chat. Who may ask and how often is under Settings, Rotation.',
    error: {
        title: 'Requests unavailable',
        fallback: 'The station could not list its requests.',
    },
    unchanged: 'The request is as it was.',
    filter: {
        open: 'Open',
        all: 'Recent',
    },
    empty: {
        open: 'Nobody is waiting on a request.',
        all: 'Nobody has asked for anything lately.',
    },
    column: {
        record: 'Record',
        askedBy: 'Asked by',
        state: 'State',
    },
    /** A state in the station's words. */
    status: {
        waiting: 'Needs a decision',
        pending: 'On its way',
        queued: 'In the running order',
        aired: 'Played',
        declined: 'Declined',
        expired: 'Lapsed',
    },
    row: {
        record: '{{title}} by {{artist}}',
        fromChat: 'From a chat, {{date}}',
        fromApp: 'From an app, {{date}}',
        fromParty: 'At the party, {{date}}',
    },
    dedication: {
        plain: 'Dedicated',
        message: 'Dedicated: “{{message}}”',
        to: 'For {{name}}',
        toWithMessage: 'For {{name}}: “{{message}}”',
    },
    grant: {
        action: 'Grant',
        error: 'Not granted',
        done: '{{record}} is on its way.',
    },
    decline: {
        action: 'Decline',
        title: 'Decline {{record}}?',
        error: 'Not declined',
        done: '{{record}} declined.',
        told: '{{name}} is told it will not be played.',
        toldInChat: '{{name}} is told it will not be played, in the chat they asked from.',
        reason: {
            label: 'What to tell them',
            placeholder: 'Not tonight.',
        },
    },
    /** A party: guests ask for records by scanning a code, with no account. */
    party: {
        title: 'Party',
        off: 'Start a party and the station gives you a code to put up. Anyone who scans it can ask for records from their phone without an account, one at a time, under the same rules as any listener.',
        start: 'Start a party',
        on: 'A party is on. Anyone who scans this code can ask for records until {{time}}.',
        guests_one: '{{count}} guest has joined.',
        guests_other: '{{count}} guests have joined.',
        qrTitle: 'The party’s code',
        copy: 'Copy the link',
        poster: 'Full screen',
        tv: 'To put it on a TV, open Full screen and cast the tab from Chrome, or mirror the screen with AirPlay.',
        loopback:
            'This code points at {{origin}}, which a guest’s phone cannot reach. Open the console at the station’s network address and the code will follow.',
        end: 'End the party',
        endTitle: 'End the party?',
        endBody: 'The code stops working, and every guest is turned away straight away. Requests already in the running order still play.',
        ended: 'The party is over.',
        endError: 'The party is still on',
        startTitle: 'Start a party',
        hours: 'How long the code works, in hours',
        hoursHint: 'Ending the party sooner is a button press. Starting a new one ends this one.',
        started: 'The party is on.',
        startError: 'No party started',
        unchanged: 'Nothing changed.',
        error: {
            title: 'Party unavailable',
            fallback: 'The station could not say whether a party is on.',
        },
    },
    /** The full-screen poster for a TV: the code, big, and what is playing. */
    poster: {
        scan: 'Scan to ask for a record',
        onAir: '{{title}} by {{artist}}',
        until: 'Until {{time}}',
        none: 'No party is on.',
        back: 'Back to requests',
        fullScreen: 'Full screen',
    },
} as const;
