/** Segments: the library of things the station plays that are not records, and the two ways into it. */
export const segments = {
    title: 'Segments',
    description:
        'Everything the station can play that is not a record. A segment is only playable once it is ready; the station skips anything else rather than waiting for it.',
    scan: {
        action: 'Scan the inbox',
        tooltip: 'Reads the inbox folder and imports any audio it does not already hold',
        nothing: 'Nothing new in the inbox ({{scanned}} scanned).',
        imported: 'Imported {{imported}} of {{scanned}} scanned.',
    },
    upload: 'Upload',
    error: {
        list: 'The segment library could not be read',
        listFallback: 'The library is unavailable.',
        scan: 'The inbox could not be scanned',
        scanFallback: 'The scan did not finish.',
    },
    empty: {
        title: 'The station has no segments',
        body: 'Upload a recording above, write one for the station to say, or drop audio into the inbox folder and scan it. The station plays what it has; without a segment it plays records back to back.',
    },
    delete: {
        title: 'Delete {{label}}?',
        confirm: 'Delete the recording',
        failed: 'The recording could not be deleted',
        failedFallback: 'It is still there.',
        body: 'The inbox file goes too, so the next scan does not read it back in. Anything the station has already aired stays in the activity feed either way.',
    },
    column: {
        label: 'Label',
        script: 'Script',
        state: 'State',
        voice: 'Voice',
        length: 'Length',
        scope: 'For',
    },
    scope: {
        everyShow: 'Every show',
        gone: 'Deleted',
        untitledSlot: 'Untitled show',
        edit: 'Choose the shows {{label}} is for',
        editTooltip: 'Choose which shows and presenters this recording is for',
        title: 'Which shows is {{label}} for?',
        body: 'A recording for a show airs only on that show, and ahead of the recordings for every show. Choose a presenter to have it follow them onto any show. It airs when either list names what is on. Choose nothing for every show.',
        shows: {
            label: 'Shows',
            description: 'Airs while one of these is on, whoever presents it',
            placeholder: 'Any show',
        },
        presenters: {
            label: 'Presenters',
            description: 'Airs while one of these presents, whichever show it is',
            placeholder: 'Any presenter',
        },
        save: 'Save',
        cancel: 'Cancel',
        failed: 'That scope was not saved',
        failedFallback: 'The recording is still for the shows it was for.',
    },
    row: {
        play: 'Play {{label}}',
        playFailed: 'That segment would not play.',
        defaultVoice: 'default',
        deleteTooltip: 'Delete it, and the inbox file behind it',
        delete: 'Delete {{label}}',
    },
    compose: {
        open: 'Write one',
        label: {
            label: 'Label',
            description: 'What the console calls it, and the mount label while it airs',
        },
        script: {
            label: 'Script',
            description: 'What the station says. The pronunciation list is applied when it is spoken.',
        },
        kind: {
            label: 'Kind',
            description: 'ident, stinger, talkbreak',
        },
        voice: {
            label: 'Voice',
            description: "Leave empty for the plugin's own default",
        },
        error: 'That segment could not be planned',
        errorFallback: 'The station did not take it.',
        done: 'Planned. The station is speaking it now.',
        submit: 'Plan it',
    },
    uploadCard: {
        title: 'Upload a recording',
        error: 'That recording did not go into the library',
        kind: {
            label: 'Kind',
            description: 'What sort of element it is. It is also the folder the file is filed under.',
            unfamiliar:
                'The station holds nothing of this kind yet, so <strong>{{kind}}</strong> will appear in the format clock as an hour you can schedule around once this is ready.',
            bed: 'A music bed runs quietly under a break the station speaks, and never airs on its own. Scope it to a show to give that show its own sound; a bed scoped to nobody plays under every show that has none of its own.',
        },
        drop: 'Drop audio here, or click to choose',
        dropHint:
            'mp3, wav, ogg, flac or m4a, up to 50 MB each. The file is written into the inbox folder, so a backup carries it and a re-scan leaves it alone.',
        column: {
            file: 'File',
            label: 'What it is called on air',
        },
        labelFor: 'Label for {{name}}',
        discardTooltip: 'Take it off the list',
        discard: 'Discard {{name}}',
        clear: 'Clear',
        send_one: 'Put it in the library',
        send_other: 'Put all {{count}} in the library',
    },
} as const;
