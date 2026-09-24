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
} as const;
