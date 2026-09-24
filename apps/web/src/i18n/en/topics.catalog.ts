/** The subjects page: what a break can be about, and the editor for one subject. Kind nouns, descriptions and field labels come from the API. */
export const topics = {
    page: {
        title: 'Subjects',
        description:
            'What a break can be about. Put one on a band in the format clock and that break covers only its subject — a technology bulletin at half past, the local news at six. Leave a band without one and the station spreads what it has.',
        loadFailedTitle: 'The subjects could not be loaded',
        loadFailedFallback: "This station's vocabulary is unavailable.",
        deleteFailedTitle: 'That could not be deleted',
        nothingRemoved: 'Nothing was removed.',
        noKinds: {
            title: 'Nothing on this station takes a subject yet',
            body: 'Subjects belong to a sort of break — news categories, and weather locations when the station can talk about the weather. None of the breaks this station can write has anything to be about, so there is nothing to name here.',
        },
        new: 'New {{noun}}',
        none: 'No {{nouns}} yet, which is a working station: every break of this sort covers whatever it finds.',
        deleteAriaLabel: 'Delete {{label}}',
        confirm: {
            title: 'Delete {{label}}?',
            titleFallback: 'Delete this subject?',
            confirm: 'Delete',
            errorTitle: 'That subject could not be deleted',
            nothingElse: 'Nothing on the format clock asks for it, so nothing else changes.',
            bands_one: '{{count}} band on the format clock asks for it and will go too.',
            bands_other: '{{count}} bands on the format clock ask for it and will go too.',
        },
        fieldCount: '{{label}} ({{count}})',
        nothingToMatch: 'nothing to match on yet',
    },
    editor: {
        nameRequired: 'A name is what the station says out loud, so it cannot be empty.',
        editTitle: 'Edit {{noun}}',
        newTitle: 'New {{noun}}',
        name: {
            label: 'Name',
            description: 'What the station calls this {{noun}} out loud.',
            placeholder: 'Technology',
        },
        key: 'Referred to as <code>{{slug}}</code>, which is what the format clock points a band at. Renaming this does not change it.',
        save: 'Save',
        failureTitle: 'That {{noun}} could not be saved',
        failureMessage: 'Nothing was written.',
    },
} as const;
