/** Readings: the books and columns the station reads out, and what it has done with each piece. */
export const narrations = {
    title: 'Readings',
    description:
        "Books, columns and anything else the station reads out in its presenter's voice. A <code>narration</code> band on the format clock reads the next piece at its time: the next chapter of a book, or the newest issue of a column. The station speaks it a few hours beforehand.",
    refresh: {
        action: 'Look for new pieces',
        queued: 'The station is reading every series again. New pieces appear here in a minute or two.',
    },
    error: {
        series: 'The series could not be read',
        seriesFallback: 'No narration plugin answered.',
        pieces: 'The pieces could not be read',
        refresh: 'The series could not be read again',
        render: 'That piece could not be asked for',
    },
    empty: {
        series: {
            title: 'The station has nothing to read yet',
            body: 'Install a narration plugin and point it at a book or a feed on its own settings page. What it offers arrives here once the station has looked.',
        },
        pieces: 'The station has found no pieces yet. It looks twice an hour; look now to see what there is.',
    },
    filter: {
        label: 'Series',
        every: 'Every series',
    },
    state: {
        read: 'Read',
        withdrawn: 'Withdrawn',
        ready: 'Ready to air',
        reading: 'Reading',
        failed: 'Could not read',
        unread: 'Not read yet',
    },
    piece: {
        words_one: '{{total}} word',
        words_other: '{{total}} words',
        readAt: 'Read {{when}}.',
        withdrawnAt: 'Withdrawn {{when}}: its source no longer lists it, so the station will not read it.',
        render: 'Read it now',
        queued: 'Reading {{title}}. It is ready to air once the station has spoken it.',
    },
} as const;
