/** What it said: every write attempt, its filters, its detail panel and the rating beside it. */
export const scripts = {
    title: {
        segment: 'One break',
        persona: 'Everything {{persona}} has said',
        all: 'Scripts',
    },
    description: {
        segment: 'Every attempt at writing this one break, newest first, including the ones that came to nothing.',
        persona:
            'Every attempt this character has made, newest first. A run of declines with the floor writing underneath is what a sheet nothing can satisfy looks like.',
        all: 'Everything the station has written, newest first, one entry per attempt. A model that declined and the line that went out instead are both here.',
    },
    failure: 'The script history could not be read.',
    empty: {
        segment: 'Nothing has been written for this break yet. The station asks for the words as the slot comes near, not when the break is planted.',
        persona: 'This character has not written anything yet. A row lands here on every attempt it makes, including the ones it declines.',
        all: 'Nothing yet. The station writes here every time it makes a break, whether or not the words made it to air.',
        filtered: 'Nothing matches that filter.',
    },
    widen: 'Read everything the station has written',
    outcome: {
        all: 'Everything',
        written: 'Written',
        declined: 'Declined',
        failed: 'Failed',
    },
    /** The two writers the station has, by their own `BreakWriter.name`. */
    writer: {
        all: 'Any writer',
        model: 'Model',
        deterministic: 'Floor',
    },
    detail: {
        kind: 'Kind',
        host: 'Host',
        model: 'Model',
        from: 'From',
        took: 'Took',
        tokens: 'Tokens',
        after: 'After',
        before: 'Before',
        note: 'Note',
        raw: 'Answer, before anything read it',
        promptNotKept: 'The prompt was not kept. Turn on <code>llm.captureWrites</code> to keep it for the attempts after this one.',
        prompt: 'What it was sent',
    },
    rating: {
        disliked: 'The station should not say things like this',
        neutral: 'Heard it, no opinion',
        liked: 'More like this',
    },
    share: {
        label: 'Share this break',
        saved: 'The break was saved as a download.',
        failure: {
            gone: 'The station no longer has the audio for that break.',
            cannotCopy: "The station can't make a copy to send right now.",
            couldNotReach: "Couldn't reach the station to get that break.",
            failed: "Couldn't get that break ready to send.",
        },
    },
} as const;
