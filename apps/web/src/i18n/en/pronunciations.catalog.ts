/** Pronunciations: the station's lexicon, what it proposed from articles, and what was turned down. */
export const pronunciations = {
    title: 'Pronunciations',
    description:
        'The names the station would otherwise read wrongly. Whatever is on the right is handed to the speech engine untouched, so write it however that engine reads best — and leave it empty to drop the words entirely, which is the honest answer for a marker that got into a title and is not a word.',
    error: {
        load: 'The lexicon could not be loaded',
        loadFallback: 'What the station says differently is unavailable.',
        add: 'That could not be added',
        addFallback: 'Nothing was written.',
        save: 'That could not be saved',
        saveFallback: 'Nothing was changed.',
        remove: 'That could not be removed',
        removeFallback: 'Nothing was removed.',
    },
    proposed: {
        title: 'Proposed',
        description:
            'Pronunciation keys the station found printed in the articles it already holds. None of these is said until it is accepted, because an article’s key is often about one word of a name and sometimes about a different name entirely.',
        accept: 'Say {{written}} this way',
        reject: 'Turn down {{written}}',
    },
    active: {
        title: 'Said this way',
        empty: {
            title: 'The station says everything as it is written',
            body: 'Nothing here yet. Add a name whose letters are not its sounds, and the station says it your way from the next break on.',
        },
        isSaid: 'is said',
        save: 'Save',
        edit: 'Edit {{written}}',
        delete: 'Delete {{written}}',
    },
    field: {
        written: 'Written',
        spoken: 'Spoken',
        said: 'Said',
    },
    add: {
        writtenPlaceholder: 'Röyksopp',
        saidPlaceholder: 'royk-sop',
        action: 'Add',
    },
    rejected: {
        title: 'Turned down',
        description: 'Kept rather than deleted, so the same article does not propose them again.',
        restore: 'Say it',
    },
    delete: {
        title: 'Stop saying {{written}} that way?',
        titleFallback: 'Delete this entry?',
        confirm: 'Delete',
        errorTitle: 'That entry could not be deleted',
        body: 'The station reads it as "{{spoken}}" today, and will say it however the engine does once this is gone.',
    },
    notSaid: 'not said',
    source: 'the article',
} as const;
