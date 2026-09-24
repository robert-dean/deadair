/**
 * The personas page's words: the roster, the character sheet, and the notebook, stories, memory,
 * rehearsal and audition panels that hang off a character.
 *
 * The phrasings help below shows the station's own `{{previous.title}}` placeholders. Those are
 * handed in as values (`TEMPLATE_EXAMPLES` in the editor), because written here they would be read
 * as i18next variables.
 */
export const personas = {
    shared: {
        done: 'Done',
        change: 'Change',
        save: 'Save',
        saved: 'Saved.',
        edit: 'Edit',
        add: 'Add',
        accept: 'Accept',
        reject: 'Reject',
        keep: 'Keep',
        delete: 'Delete',
        proposed: 'Proposed',
        turnedDown: 'Turned down',
        keptNotProposed: 'Kept rather than deleted, so the station does not propose them again.',
        stationsOwn: "the station's",
        stopEditing: 'Stop editing',
        saveFailedTitle: 'That could not be saved',
        settingsUnavailable: 'The station settings are unavailable.',
        unchanged: 'Nothing about this character has changed.',
        voicePreviewFailed: 'That voice could not be previewed.',
        breakSpeakFailed: 'That break could not be spoken.',
        between: 'between {{previous}} and {{next}}',
        skipped: '{{reason}} — on air this break would be skipped, and the station would go straight to the next record.',
    },
    page: {
        title: 'Personas',
        description:
            'Who the station is when it talks. The one on air decides how a break is written, what it says when nothing wrote it and which voice reads it; a change is heard on the next break. Callers are the other half of the roster: they never present, and they are cast into a production when one wants somebody on the phone.',
        exportAll: 'Export all',
        import: 'Import',
        restore: 'Restore built-ins',
        newCaller: 'New caller',
        newHost: 'New host',
        loadError: {
            title: 'Personas could not be loaded',
            fallback: 'The persona list is unavailable.',
        },
        restoreError: {
            title: 'The station personas could not be restored',
            fallback: 'Nothing was written.',
        },
        exportError: {
            title: 'The personas could not be exported',
            fallback: 'Nothing was saved.',
        },
        empty: "This station has no personas, which is an ordinary state rather than a fault: it writes its breaks from the station's own phrasings and speaks them in the plugin's default voice. Write one to give it a character.",
        filter: {
            placeholder: 'Find a character',
            clear: 'Clear the filter',
        },
        noMatch: 'No character here matches that. Clear the box to see the whole roster again.',
        heading: {
            hosts: 'Hosts',
            callers: 'Callers',
        },
    },
    card: {
        onAirNow: 'On air now',
        stationsOwn: 'Station’s own',
        speaksAs: 'speaks as {{voice}}',
        voiceWithDescription: '{{voice}}, {{description}}',
        playVoice: 'Play a sample of the voice {{label}} speaks in',
        said: "What they've said",
        makeHost: 'Make station host',
        madeHost: '{{label}} is the station’s host now.',
        rehearse: 'Rehearse',
        more: 'More about {{label}}',
        menu: {
            notebook: 'Notebook',
            hideNotebook: 'Hide notebook',
            stories: 'Stories',
            hideStories: 'Hide stories',
            memory: 'Memory',
            hideMemory: 'Hide memory',
            export: 'Export',
            exporting: 'Saving…',
        },
        failure: {
            host: 'The station is still in the character it was.',
            rehearse: 'Nothing was changed: a rehearsal writes no row and cannot air.',
            export: 'Nothing was saved.',
        },
        record: {
            counts: '{{written}} written · {{declined}} declined',
            failed: '· {{failed}} failed',
            window_one: 'in {{count}}h',
            window_other: 'in {{count}}h',
        },
        summary: {
            noPhrasings: "no phrasings of its own, so it falls back to the station's when the model declines",
            unchecked: 'not checked for staying in character',
            defaultVoice: "speaks in the plugin's default voice",
        },
        ringsIn: 'Rings in to {{names}}',
    },
    editor: {
        title: {
            newCaller: 'New caller',
            newHost: 'New host',
            edit: 'Edit {{label}}',
        },
        validate: {
            key: 'A persona needs a key',
            label: 'A persona needs a name',
            style: 'Say who this character is',
        },
        generate: {
            eyebrow: 'Start from a description',
            placeholderCaller: 'a taxi driver who rings in every week to argue about the charts',
            placeholderHost: 'a 1970s northern soul DJ who broadcasts from the back of a chip shop',
            description: 'Fills in the fields below. Nothing is saved until you press Save, and you can change any of it first.',
            errorTitle: 'Nothing was written',
            errorFallback: 'The station could not write a persona. Your own fields are untouched.',
            button: 'Write me one',
        },
        dropped: {
            title: 'Some of it was dropped',
            markers:
                'The model called these words its own and then never used them, so they were left out: {{markers}}. A word the character does not actually say would refuse every break it writes.',
            templates_one: '{{count}} phrasing named something the station cannot fill in, so it was left out.',
            templates_other: '{{count}} phrasings named something the station cannot fill in, so they were left out.',
        },
        section: {
            who: {
                title: 'Who they are',
                blurb: 'The half of a character the model is told about. Everything here completes "You are …".',
            },
            ring: {
                title: 'Who they ring',
                blurb: 'A phone-in is cast from the callers who ring whoever is presenting it. Among them, whoever rang longest ago goes first.',
            },
            talk: {
                title: 'How they talk',
                blurb: 'The dialect, and the words that prove a break came back in character. A break carrying none of them is rewritten from the phrasings below.',
            },
            fallback: {
                title: 'What they fall back on',
                blurb: 'Most breaks are not written by a model. These are the words the station uses when it declines — a character with none falls back to plain English.',
            },
            dials: {
                title: 'How far they go',
                blurb: 'Dials with real consequences on air. They change what the station ASKS its presenter for — how long a break is, how much room it gets, and how often one happens. None of them can loosen what the station always sends: every refusal, and your explicit-content setting, hold whatever is set here.',
            },
        },
        field: {
            name: {
                label: 'Name',
                description: 'What the roster calls them.',
                placeholder: 'Late-night companion',
            },
            key: {
                label: 'Key',
                descriptionOwn: 'A short slug, unique to this station.',
                descriptionDerived: 'A short slug, unique to this station. Follows the name until you write your own.',
            },
            style: {
                label: 'Who they are',
                description: 'Completes "You are …". Who they ARE; how they talk is below.',
                placeholder: 'a quiet late-night host sitting close to the mic',
            },
            djName: {
                label: 'On-air name',
                description: "Overrides the station's presenter name while this persona is on air. Leave empty to keep it.",
                suggest: 'Suggest an on-air name',
            },
            background: {
                label: 'True about them',
                description: 'A couple of grounded facts they may mention about themselves.',
            },
            hosts: {
                label: 'Rings in to',
                description: 'Leave it empty and they ring in to whoever is presenting.',
                remove: 'Remove {{label}}',
            },
            diction: {
                label: 'How they speak',
                description: 'The dialect, one rule per line. This applies to EVERY sentence, including the ones stating a plain fact.',
                placeholder: 'Always contract: "you\'re", "that\'s"\nSpeak to one person, not a crowd',
            },
            markers: {
                label: 'Words that prove it',
                description:
                    "One per line. A break that comes back carrying none of these is treated as out of character and the phrasings below write it instead. An entry ending in an apostrophe matches as a suffix, so in' catches every dropped g. Leave empty to check nothing.",
                placeholder: "ye\naye\nmatey\nin'",
            },
            quirks: {
                label: 'In character',
                description: 'What they always and never do on air, one per line.',
            },
            catchphrases: {
                label: 'Signature phrases',
                description: 'One per line. Asked for sparingly: at most one, and not every break.',
            },
            avoid: {
                label: 'Never say',
                description: 'One per line.',
            },
            exclusive: {
                label: 'Never in the same break',
                description:
                    "One subject per line, written as the words that mean it, separated by commas. A break that brings up words from two lines is refused and written again; a word inside a record's title does not count. Leave empty to keep nothing apart.",
                placeholder: 'bigfoot, sasquatch, yeti\nchemtrail, contrail',
            },
            templates: {
                label: 'Their own phrasings',
                description:
                    'One per line. Fill a record in with {{previousTitle}}, {{nextArtist}} and the like, wrap a part in [[double brackets]] to have it dropped when there is nothing to put in it, and start a line with # to turn it off. These are what the station says when the model declines, which is most breaks, so a character with none falls back to plain English.',
                placeholder: 'That was {{previousTitle}}, from {{previousArtist}}.[[ Next up, {{nextTitle}}.]]',
            },
            samples: {
                label: 'Lines in their voice',
                description: 'One per line. Used as examples for the model, which is asked to reuse the grammar and never the sentences.',
            },
            voice: {
                label: 'Voice',
                description: 'Leave empty for whatever the speech plugin uses by default.',
                descriptionUnmapped: 'No speech plugin is answering, so this is the id as your engine will map it.',
                play: 'Play a sample of this voice',
            },
            soundboard: {
                label: 'Soundboard',
                description: 'The set of sounds this character can reach for. Leave empty for a presenter who works without one.',
            },
            preoccupations: {
                label: 'What they keep coming back to',
                description:
                    'One subject per line. Only ONE of these reaches any break, chosen in turn, so a longer list is more variety rather than more to say at once. These are subjects; the rules about how they behave belong above.',
                placeholder: 'the pressing plant\nthe session that booked four hours\nthe running order of this station',
            },
        },
        dial: {
            brevity: {
                label: 'How much they say',
                description:
                    "Only shorter than the station's usual, because the length of a break is set by where the model stops rather than by the ceiling. It asks for less; nothing refuses a break for running past it.",
                usual: "The station's usual",
                short: 'Says less — a sentence or two',
                oneLine: 'Says almost nothing — one line',
            },
            latitude: {
                label: 'How much rope they get',
                description:
                    "Room to follow a thought instead of making one point, with a longer break to do it in. On links, welcomes and the character's own stories, never the news or the weather. The station's explicit-content setting still outranks it, and a break that names neither record or drops the character is still refused.",
                usual: "The station's usual discipline",
                loose: 'Room — follows a thought where it goes',
                unleashed: 'Off the leash — and says it however they like',
            },
            trivia: {
                label: 'How much they lean on what the station knows',
                description:
                    'What the station has learned about a record: who made it, where it came from, what happened to it. Keen presenters are handed more of it, a note about the album and the artist as well as the track, and are asked to build each link out of the story, with a longer break to tell it in. Links only. They can still only say what a note says.',
                usual: "The station's usual — a note now and then",
                keen: 'Keen — the story behind every record',
            },
            storytelling: {
                label: 'How often they bring up their own past',
                description:
                    "Their stories are kept on this character's own shelf, and at most one ever reaches a break. This is only about ordinary talk breaks: a story band on your clock asks for one whatever this says.",
                occasionally: 'Occasionally — when nothing is known about the records',
                often: 'Often — most breaks',
                never: 'Never in a link',
            },
            growth: {
                label: 'Whether they develop on their own',
                description:
                    'What the nightly passes do with material they write for this character: hold it for you to accept, or put it straight into use. Self-directed characters change between one week and the next without being asked. Everything they accrue can be rolled back from the Memory panel.',
                proposes: 'Proposes — you approve anything new',
                selfDirected: 'Self-directed — it keeps what it writes',
            },
            chattiness: {
                label: 'How often they talk',
                description:
                    'Scales the gap your station leaves between its own breaks. It does not touch anything on your clock: a band asking for news at nine is you asking in as many words. There is no silent setting — turning breaks off is a station setting, and two switches for one thing would disagree.',
                ordinary: "Ordinary — the station's own interval",
                relentless: 'Relentless — twice as often',
                chatty: 'Chatty — a little more often',
                sparing: 'Sparing — a little less often',
                reserved: 'Reserved — half as often',
            },
        },
        readout: {
            sentence: "{{manner}}, in {{length}}. The station's content rules and its refusals are unchanged either way.{{lore}}{{stories}}{{often}}",
            length: {
                oneLine: 'one line',
                short: 'a sentence or two',
                usual: "the station's usual length",
                long: 'as long as it takes',
            },
            manner: {
                unleashed: 'Says what it likes, however it likes',
                loose: 'Follows a thought where it goes',
                usual: 'Makes one point',
            },
            stories: {
                never: ' It keeps its stories to itself in a link.',
                often: ' It works one of its own stories into most breaks.',
                occasionally: ' It reaches for one of its own stories when the station knows nothing about the records.',
            },
            lore: ' It builds each link out of the story behind the record, from what the station knows about it.',
            often: {
                relentless: ' It talks twice as often as the station would on its own.',
                chatty: ' It talks a little more often than the station would on its own.',
                sparing: ' It talks a little less often than the station would on its own.',
                reserved: ' It talks half as often as the station would on its own.',
            },
        },
        faults: {
            title_one: 'The station would never pick one of these',
            title_other: 'The station would never pick {{count}} of these',
            // `<code/>` is filled with the phrasing itself, which is the component's own child.
            line: '<code/> {{fault}}.',
        },
        unusedMarkers:
            'Nothing in the lines above uses {{markers}}. A break is refused for carrying none of these words, so it is worth showing the model at least one of them in use.',
        saveError: {
            title: 'That could not be saved',
            fallback: 'The persona could not be saved.',
        },
        rehearse: {
            button: 'Hear a rehearsal',
            note: 'Speaks this character as it was last SAVED. Save first to hear an edit.',
            errorTitle: 'Nothing was spoken',
            errorFallback: 'The station could not rehearse this character.',
        },
        rules: 'Nothing here can loosen the rules the station always sends: never name a record it was not given, and be certain or say nothing. Saving is heard on the next break the station writes — one already written or being spoken keeps the words it has.',
        discard: {
            titleNew: 'Throw this character away?',
            titleEdit: 'Throw away your changes to {{label}}?',
            confirm: 'Discard',
            bodyNew: 'Nothing here has been saved, so closing now leaves the station with no such character. Keep writing to come back to it.',
            bodyEdit: 'Nothing here has been saved. The character stays exactly as it was, and everything you have typed since opening this goes.',
        },
    },
    template: {
        unknown: 'names {{placeholders}}, which the station cannot fill in',
        strayBracket: 'has a single bracket, which is read out rather than treated as an optional part',
        noPlaceholder: 'names no record, so it would say the same thing after every one',
    },
    deleteModal: {
        title: 'Delete {{label}}?',
        confirm: 'Delete',
        errorTitle: 'That persona could not be deleted',
        errorFallback: 'Nothing was removed.',
        body: 'Its sheet goes, and so do its own phrasings{{notebook}}. Anything it has already written and rendered keeps the words it has; nothing on air changes.',
        notebook_one: ', and the {{count}} note in its notebook',
        notebook_other: ', and the {{count}} notes in its notebook',
        restorable: "The station's own characters can be written back with Restore built-ins. One you wrote yourself cannot.",
    },
    import: {
        title: 'Import personas',
        intro: "A file saved by this page, or by somebody else's station. Characters are matched by their key: one this station already has is rewritten and its stories are added to, and one it does not is created. Nothing is ever deleted, and nobody is put on air.",
        choose: 'Choose a file',
        chooseAnother: 'Choose another file',
        unreadable: '"{{name}}" is not a file this can read. A persona file is the JSON one of these pages saved.',
        previewError: {
            title: 'That file could not be read',
            fallback: 'It is JSON, but not a persona file this station recognises.',
        },
        writeError: {
            title: 'Nothing was imported',
            fallback: 'The station is exactly as it was: an import that fails part-way is undone in full.',
        },
        done: 'Done',
        result: {
            title: 'Imported',
            summary: '{{characters}} written, {{sheets}} rewritten, {{stories}} and {{details}} added.',
            onAir: "Nobody was put on air. Use <strong>Make station host</strong> on a character's card when you want it presenting.",
        },
        characters_one: '{{count}} character',
        characters_other: '{{count}} characters',
        sheets_one: '{{count}} sheet',
        sheets_other: '{{count}} sheets',
        stories_one: '{{count}} story',
        stories_other: '{{count}} stories',
        details_one: '{{count}} detail',
        details_other: '{{count}} details',
        column: {
            character: 'Character',
            landsAs: 'Lands as',
            stories: 'Stories',
        },
        caller: 'Caller',
        outcome: {
            create: 'New',
            update: 'Rewrite',
        },
        button: {
            create: 'Import {{characters}}',
            update: 'Rewrite {{characters}}',
            both: 'Import {{creates}}, rewrite {{updates}}',
        },
        storyLine: {
            added: '{{added}} new',
            held: '{{held}} already here',
            both: '{{added}} new · {{held}} already here',
        },
    },
    memory: {
        eyebrow: 'Memory',
        subtitle: 'what this character has told, and how far back to undo it',
        loadError: 'The timeline could not be loaded',
        rollbackError: {
            title: 'Nothing was rolled back',
            fallback: 'This character is exactly as it was.',
        },
        empty: {
            title: 'This character has not told anything yet',
            body: 'A story goes on the timeline when a break carries it. Until then there is nothing to undo.',
        },
        clearTooltip: 'Clears everything this character accumulated on its own. What you wrote by hand stays.',
        clearAll: 'Clear all of it',
        confirm: {
            titleReset: 'Clear everything {{label}} has accumulated?',
            titleRollback: 'Roll {{label}} back to before this?',
            after: 'Everything after {{moment}} goes. That telling itself stays.',
            previewErrorTitle: 'That could not be worked out',
            previewErrorFallback: 'Nothing has been changed.',
            relearn: 'Read those broadcasts again tonight',
            relearnDescription:
                'Leave this off to undo what the station concluded. Turn it on to have it work through the same scripts from scratch, which is what you want when you are testing.',
            leave: 'Leave it',
            clear: 'Clear it',
            rollBack: 'Roll back',
        },
        summary: {
            nothing: 'There is nothing after that moment to undo.',
            tellings: 'tellings forgotten',
            notes: 'notes',
            stories: 'stories',
            details: 'details',
            stationOnly: 'Only what the station wrote itself. Anything you typed stays exactly where it is.',
            rejected_one: 'One of them was a proposal you turned down, so the nightly pass may offer it again.',
            rejected_other: '{{count}} of them were proposals you turned down, so the nightly pass may offer it again.',
            touched_one: 'One of them you had accepted or edited, and it still goes.',
            touched_other: '{{count}} of them you had accepted or edited, and it still goes.',
        },
        telling: {
            passedOverTooltip: 'It was offered and the writer did not use it',
            passedOver: 'passed over',
            notAiredTooltip: 'Written, but no listener has heard it yet',
            notAired: 'not aired',
            rollBackTooltip: 'Undo everything after this',
            rollBack: 'Roll back to here',
        },
    },
    notes: {
        eyebrow: 'Notebook',
        subtitle: 'what this character has settled into, and what it has said before',
        loadError: 'The notebook could not be loaded',
        saveError: {
            title: 'That note could not be saved',
            fallback: 'The notebook is as it was.',
        },
        inUse: 'In use',
        empty: 'This character has accumulated nothing yet, which is an ordinary state: its breaks are written from its sheet alone, exactly as they were before there was a notebook. Write a note, or let the station propose one from what it has already said.',
        useAnyway: 'Use anyway',
        kind: {
            trait: 'settled into',
            said: 'said before',
        },
        quoteTooltip: 'What the station actually said, which is what this note was drawn from',
        composer: {
            kind: 'Kind',
            trait: 'Settled into',
            said: 'Said before',
            label: 'A note',
            placeholder: 'calls the listener a shipmate',
        },
    },
    rehearsal: {
        eyebrow: 'Rehearsal',
        hear: 'Hear this break',
        nothingWrites: 'Nothing writes a talk break on this station.',
        nothingToSay: 'nothing to say',
        duration: '{{ms}}ms',
    },
    stories: {
        eyebrow: 'Stories',
        subtitle: 'things that have happened to this character, told on air',
        loadError: 'The stories could not be loaded',
        saveError: {
            title: 'That story could not be saved',
            fallback: 'The shelf is as it was.',
        },
        tellable: 'Tellable',
        empty: 'This character has nothing to tell, which is an ordinary state: its breaks are written from its sheet alone, and a story band on the clock passes its slot over rather than inventing a past. Write one, and the station will tell it.',
        tellAnyway: 'Tell it anyway',
        kind: {
            anecdote: 'A one-off — told whole, whenever it comes round',
            arc: 'A story in parts — one part per break, in order',
            bit: 'A running joke — returned to and built on, with no end',
        },
        neverTold: 'never told',
        told_one: 'told once',
        told_other: 'told {{count}} times',
        titleLabel: 'What this story is called',
        storyLabel: 'The story',
        kindLabel: 'What sort of story this is',
        source: 'from {{source}}',
        proposedBeat: 'proposed: {{beat}}',
        next: 'next',
        beatPlaceholder: 'what happens next in it',
        beatLabel: 'The next part of this story',
        proposedDetail: '· proposed: {{detail}}',
        detailPlaceholder: 'something else you remember about it',
        detailLabel: 'Add a detail to {{title}}',
        addDetail: 'Add detail',
        composer: {
            title: 'What you call it',
            titleDescription: 'Never said out loud. It is how this list is read, and how the station names one in a log.',
            titlePlaceholder: 'The Barstow lights',
            story: 'The story',
            storyDescription: "In this character's own voice, and out loud: with no model available the station reads it exactly as you write it.",
            storyPlaceholder:
                'You saw three lights over the desert outside Barstow in ninety-seven. No sound at all, and gone before the tape was running.',
        },
    },
    auditions: {
        character: 'Character',
        onAir: '{{label}} (on air)',
        playlist: 'Playlist',
        playlistDescription: 'Read once, when you press Start.',
        breaks: 'Breaks',
        start: 'Start',
        note: "Nothing here airs, and nothing is spent: the character's notebook and stories are read for each break and left where they are. Each break waits for the model behind everything the station is doing for itself, so a run fills in over minutes.",
        rosterError: 'Could not read the roster',
        playlistsError: 'Could not read the playlists',
        startError: {
            title: 'Nothing was started',
            fallback: 'That audition could not be started.',
        },
        cancelError: 'Could not stop that audition',
        runsError: 'Could not read this character’s auditions',
        empty: {
            title: '{{label}} has not been auditioned yet',
            titleUnknown: 'This character has not been auditioned yet',
            body: 'Pick a playlist above and press Start. Ten breaks is about an hour of radio, and you can read them as they land.',
        },
    },
    audition: {
        hide: 'Hide',
        read: 'Read',
        stop: 'Stop',
        queued: 'Queued. Each break waits for the model behind everything the station is doing for itself, so this fills in slowly.',
        readError: 'Could not read this audition',
        hear: 'Hear break {{number}}',
        tally: {
            model: '{{model}} by the model',
            declined: '{{declined}} declined',
            failed: '{{failed}} failed',
        },
        state: {
            queued: 'Waiting for the model',
            running: 'Writing',
            done: 'Finished',
            failed: 'Stopped by a fault',
            stopped: 'Stopped',
        },
    },
    presenterName: {
        eyebrow: 'Presenter name',
        readError: 'The presenter name could not be read',
        saveFallback: 'The presenter name could not be saved.',
        label: 'Presenter name',
        description:
            'Used by any host without a name of its own, and while nobody is on air. It fills the phrasings that ask for a name and tells the model what it is called. Leave it empty and neither happens.',
        summary: {
            namedAllOwn: 'Every host here has a name of its own, so {{name}} is heard only while nobody is on air.',
            namedFor_one: '{{who}} goes by {{name}} on air, having no name of its own.',
            namedFor_other: '{{who}} go by {{name}} on air, having no name of their own.',
            allOwn: 'Every host here has a name of its own.',
            unnamed_one: '{{who}} has no name on air, so the phrasings that ask for one are skipped. Set one here, or give it one in its own editor.',
            unnamed_other:
                '{{who}} have no name on air, so the phrasings that ask for one are skipped. Set one here, or give them one in their own editor.',
        },
    },
    presenting: {
        eyebrow: 'Presenting now',
        // `<strong/>` is filled with the host's name, as the component's own child.
        body: "The show on air is presented by <strong/>, which the broadcast named for itself. Putting a persona on air below changes the station's own host, which takes over when this show ends.",
        unknownHost: 'a character this station no longer has',
        handBack: 'Hand it back',
        failure: 'The show kept the host it had.',
        note: "Handing it back re-writes the breaks already written for this show and not yet aired, in whoever's character it lands in.",
    },
    storyWait: {
        eyebrow: 'Returning to a story',
        readError: 'The story wait could not be read',
        saveFallback: 'The story wait could not be saved.',
        label: 'Wait before returning to a story (minutes)',
        description:
            'How long a presenter leaves a story in parts, or a running joke, before coming back to it. Long enough that a listener hears the character return to something rather than dwell on it. {{min}} is a floor rather than a suggestion: breaks are written several records ahead, and below it two of them can be handed the same part.',
        summary: 'A presenter leaves {{duration}} before returning to a story in parts or a running joke.',
        minutes_one: '{{count}} minute',
        minutes_other: '{{count}} minutes',
        anHour: 'an hour',
        hours_one: '{{count}} hour',
        hours_other: '{{count}} hours',
    },
} as const;
