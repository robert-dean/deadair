/** The Voice destination: its heading and the tabs under it, which the shell's rail and palette also read. */
export const voice = {
    title: 'Voice',
    tab: {
        characters: { label: 'Characters', hint: 'Who the station is when it talks' },
        auditions: { label: 'Auditions', hint: 'A character over an hour of records, before it goes on air' },
        voices: { label: 'Voices', hint: 'Which voice reads which character' },
        segments: { label: 'Segments', hint: 'Recordings it plays rather than speaks' },
        pronunciations: { label: 'Pronunciations', hint: 'Names it was getting wrong' },
        soundboard: { label: 'Soundboard', hint: 'Beds, stings and what plays under a break' },
        phrasings: { label: 'Phrasings', hint: 'Its words around a greeting, a jingle or a bulletin' },
        subjects: { label: 'Subjects', hint: 'What it is allowed to talk about' },
        productions: { label: 'Productions', hint: 'Phone-ins and anything with more than one voice' },
        said: { label: 'What it said', hint: 'Every break it has written, and every one it declined' },
    },
} as const;
