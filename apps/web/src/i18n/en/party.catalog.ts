/** The guest request page at /party: what somebody at a party sees after scanning the station's code. */
export const party = {
    title: 'Ask for a record',
    onAir: 'On air: {{title}} by {{artist}}',
    joining: 'Joining the party…',
    ended: {
        title: 'This party has ended',
        body: 'Ask whoever is running the music for a new code.',
    },
    noPass: {
        title: 'Scan the party’s code',
        body: 'This page needs the code on the poster. Point your phone’s camera at it.',
    },
    full: {
        title: 'This party is full',
        body: 'The station has let in as many guests as it will for this party.',
    },
    unreachable: 'Can’t reach the station. Check you are on the right wifi, then try again.',
    retry: 'Try again',
    intro: 'The station plays a request soon after it is asked for, between two records, if its rules allow. One at a time.',
    endsAt: 'The party’s code works until {{time}}.',
    search: {
        label: 'Search for a record',
        placeholder: 'Search by title or artist',
        nothing: 'Nothing the station could play matches that.',
        failed: 'The search did not work. Try again in a moment.',
    },
    row: {
        request: 'Request “{{title}}”',
        detail: '{{artist}} · {{detail}}',
        from: 'From {{source}}',
    },
    sheet: {
        title: 'Request “{{title}}”',
        name: 'Your name',
        nameHint: 'Leave it blank to be “a listener”',
        dedicateTo: 'Dedicate it to',
        message: 'A message',
        messageHint: 'The presenter may put it in their own words',
        send: 'Send request',
    },
    outcome: {
        waiting: '“{{title}}” is in. The station’s operator will look at it.',
        onItsWay: '“{{title}}” is on its way.',
        refused: 'The station turned that one down.',
        gone: 'The station cannot play that record any more.',
        failed: 'That did not send. Try again.',
    },
    mine: {
        title: 'Your requests',
        none: 'You have not asked for anything yet.',
        for: 'For {{name}}',
        aired: 'Played at {{time}}',
    },
    /** A request's state, in the words the listener apps use. */
    state: {
        waiting: 'Waiting for the operator',
        pending: 'On its way',
        queued: 'Coming up',
        aired: 'Played',
        declined: 'Turned down',
        expired: 'Not played',
    },
} as const;
