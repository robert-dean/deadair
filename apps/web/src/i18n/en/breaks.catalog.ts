/** The kinds of break an operator writes, on the Voice destination's Kinds of break tab. */
export const breaks = {
    page: {
        title: 'Kinds of break',
        description:
            'A kind of break you write yourself: a short brief saying what it is for, and what the presenter may see while writing one. Switch it on, then add a band for it on the format clock, and the station writes one whenever the band comes round, in the voice of whoever is presenting.',
        new: 'New kind of break',
        loadFailedTitle: 'Could not load your kinds of break',
        loadFailedFallback: 'The station did not answer.',
        deleteFailedTitle: 'Could not delete that kind of break',
        nothingRemoved: 'Nothing was removed.',
        empty: {
            title: 'No kinds of break yet',
            body: 'Write one: a two-line poem about the moment, a memory of taping songs off the radio, anything the station could say between records.',
        },
        column: {
            name: 'Name',
            key: 'On the clock as',
            state: 'State',
        },
        state: {
            off: 'Off',
            on: 'On',
            blocked: 'Not airing',
            blockedHint:
                'The station writes these with its model and speaks them with its voice, and one of the two is switched off. Nothing airs until both are on.',
        },
        noBands: 'No band yet',
        bands_one: 'On {{count}} band',
        bands_other: 'On {{count}} bands',
        deleteAriaLabel: 'Delete {{name}}',
        confirm: {
            title: 'Delete {{name}}?',
            titleFallback: 'Delete this kind of break?',
            body: 'Breaks it has already written stay in the station’s history. This cannot be undone.',
            confirm: 'Delete',
            errorTitle: 'Could not delete it',
        },
        notes: {
            rules: 'The station’s own rules for every break still apply on top of whatever you write here: a break stays in character, names no record it was not shown and states nothing it was not told.',
        },
    },
    editor: {
        newTitle: 'New kind of break',
        editTitle: 'Edit {{name}}',
        name: {
            label: 'Name',
            description: 'What the console calls it. It is never read out.',
            placeholder: 'A poem about the moment',
        },
        key: {
            label: 'On the format clock as',
            description: 'Lowercase words joined by hyphens. A band names it by this, so it cannot change once saved.',
            fixed: 'Bands name it by this, so it cannot change.',
            placeholder: 'poem',
            invalid: 'Use lowercase letters and digits, with single hyphens between words.',
        },
        brief: {
            label: 'What it is for',
            description:
                'Written to the presenter: what to cover, and when to say nothing. The station reads it before every one of these it writes.',
            placeholder: 'Two unrhymed lines about this moment on the station, and nothing else. No rhymes, and no record names.',
        },
        rules: {
            label: 'Rules of its own',
            description: 'One per line, added after the rules every break follows. Optional.',
            placeholder: 'Never more than two lines.',
        },
        sees: {
            title: 'While writing one, the presenter sees',
            previous: 'The record that has just finished',
            played: 'The rest of this show’s records, to refer back to',
            facts: 'What the station knows about those records',
            notebook: 'Their own notebook',
        },
        enabled: {
            label: 'Switched on',
            description: 'Off until you have read it back. A band for it airs nothing while it is off.',
        },
        required: 'Fill this in.',
        save: 'Save',
        failureTitle: 'Could not save this kind of break',
        failureFallback: 'Nothing was saved.',
    },
} as const;
