/**
 * The shell's words: the rail, the phone's bar and menu, the command palette, the header's corner
 * and the names of the console's themes.
 */
export const shell = {
    destination: {
        desk: 'Desk',
        programme: 'Programme',
        library: 'Library',
        voice: 'Voice',
        checkup: 'Check-up',
        settings: 'Settings',
        plugins: 'Plugins',
        plugin: 'Plugin',
        record: 'Record',
    },
    navItem: {
        attention_one: '{{label}}, {{count}} thing needs attention',
        attention_other: '{{label}}, {{count}} things need attention',
        withHint: '{{label}}. {{hint}}',
    },
    logout: 'Logout',
    phoneMenu: {
        label: 'Check-up, Settings and Logout',
    },
    phoneTabs: {
        label: 'Destinations',
    },
    clock: {
        label: 'Station clock',
    },
    update: {
        title: 'deadair {{version}} is out. See what changed.',
        isOut: '<version>{{version}}</version> is out',
    },
    jumpTo: {
        group: {
            destinations: 'Destinations',
            records: 'Records',
            artists: 'Artists',
            characters: 'Characters',
        },
        deskDescription: 'What is going out, what needs you, and what is next',
        artist: 'Artist',
        caller: 'Caller',
        host: 'Host',
        searching: 'Searching…',
        nothingFound: 'No page, record or character by that name.',
        placeholder: 'Jump to anything',
    },
    theme: {
        carbon: {
            name: 'Carbon',
            blurb: 'The studio at night. Phosphor green on carbon.',
        },
        white: {
            name: 'Studio White',
            blurb: 'Daylight and paper. Rules instead of fills.',
        },
        neon: {
            name: 'Neon Transmitter',
            blurb: 'Neon yellow on teal-black, lit cyan and magenta. Loudest of the three.',
        },
    },
} as const;
