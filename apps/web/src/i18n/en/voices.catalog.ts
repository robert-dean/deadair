/** Voices: what the station can sound like, who speaks in each voice, and where the mapping is set. */
export const voices = {
    title: 'Voices',
    spokenBy: 'Spoken by <anchor>{{plugin}}</anchor>, where what each of these maps to is set.',
    description: 'What the station can sound like.',
    error: {
        title: 'Voices could not be loaded',
        fallback: 'The voice list is unavailable.',
    },
    empty: {
        title: 'The station has no voice yet',
        fallback: 'No plugin is available to speak.',
    },
    row: {
        news: 'the news',
        firstTime: 'Speaking it for the first time, which takes a moment. After that it is cached.',
        play: 'Play a sample of {{label}}',
        pause: 'Pause the sample of {{label}}',
        playFailed: 'That voice could not be previewed.',
    },
    wrongVoice: "A voice that sounds wrong is a mapping to change: <anchor>edit the voice table in {{plugin}}'s settings</anchor>.",
} as const;
