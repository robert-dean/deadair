/**
 * The running order's words, and the three things done to it from the desk: planning the station,
 * taking a call, and changing who presents.
 */
export const onair = {
    runsDry: {
        repeat: 'It starts again from the top rather than running out.',
        stop: 'The station goes off air then.',
        extend: 'It tops itself up before then, while there is something to play.',
    },
    call: {
        failed: 'Nobody could be put on the phone.',
        hint: 'Puts somebody on the phone. It is written over a few minutes and drops into the running order when it is ready.',
        take: 'Take a call',
        intro: 'A listener rings in and your host takes it: a few short turns, each in its own voice. Who calls is whichever of your callers has been heard from least recently.',
        aboutLabel: 'What they are ringing about',
        aboutPlaceholder: 'a record everybody else got wrong',
        unbriefed: 'Leave it empty and the call is about whatever your host’s show is about, with the caller coming at it their own way.',
        wait: 'Nothing airs while you wait. The turns are written and spoken one at a time, and the whole call goes in together — so it lands in a few minutes rather than at the next boundary. It shows up on Productions while it is being made.',
    },
    visit: {
        failed: 'Nobody could be brought in.',
        hint: 'Brings a guest into the studio for a short chat with your host. It is written over a few minutes and drops into the running order when it is ready.',
        take: 'Bring in a guest',
        intro: 'A guest drops by the studio and your host talks with them: a few short turns, each in its own voice. Who comes in is whichever of your guests has been heard from least recently.',
        aboutLabel: 'What they are in to talk about',
        aboutPlaceholder: 'the record they made in a barn',
        unbriefed:
            'Leave it empty and the visit is about whatever your host’s show is about, with the guest coming at it their own way. A station with no guests cannot make one: write a guest on the Personas page first.',
        wait: 'Nothing airs while you wait. The turns are written and spoken one at a time, and the whole visit goes in together, so it lands in a few minutes rather than at the next boundary. It shows up on Productions while it is being made.',
    },
    host: {
        failed: 'The host could not be changed.',
        presentedBy: 'Presented by {{host}}',
        nobody: 'nobody',
        hint: 'Who presents this show. Changing it re-writes the breaks already written for it, and one that is not ready when its slot comes round is skipped.',
        stationsHost: 'The station’s host',
    },
    route: {
        label: 'Or travel from one artist to another',
        description:
            'The station finds a way between two artists your library holds, one record each, every step a record two of them share or a similarity source calling them alike. Leave both empty for an ordinary show.',
        from: 'From',
        to: 'To',
        fromPlaceholder: 'Portishead',
        toPlaceholder: 'Daft Punk',
        preview: 'Preview the route',
        previewFailed: 'The route could not be worked out.',
        none: 'There is no way between those two through artists your library holds a record by.',
        summary_one: '{{count}} stop: {{factual}} on a shared record, {{similar}} on a similarity source.',
        summary_other: '{{count}} stops: {{factual}} on a shared record, {{similar}} on a similarity source.',
        start: 'to start',
        viaCredit: 'together on "{{title}}" by {{lead}}',
        viaSimilar: 'named alike by {{source}}',
    },
    plan: {
        replanFailed: 'The running order could not be replanned.',
        onAirFailed: 'The station could not be put on air.',
        hint: 'Change what the station plays, either from here on or as a new show.',
        button: 'Plan',
        title: 'Plan',
        scope: {
            keep: 'Keep this show',
            new: 'Start a new show',
        },
        keepIntro:
            "The station's own records still to come are dropped and it programmes that stretch again. What is playing, what the player is already holding, listeners' requests, productions and anything you added yourself all keep their places.",
        newIntro:
            'The station programmes itself against this, from your own library first and from your providers when the library cannot fill it. A record it does not own yet is fetched and kept. What you like and dislike is taken into account either way.',
        newWarning: 'This starts a new broadcast: everything still to come is dropped, and what is playing stops.',
        keepBrief:
            'This steers every refill for the rest of the broadcast, not just these records. Empty it and the station goes back to its ordinary rotation.',
        newBrief: 'In your own words, for the model that chooses records. It keeps steering every refill until the station is put on air again.',
        keepBound: 'The host, the period and the shape belong to this show and keep running with it. Changing any of them starts a new one.',
        keepFooter: 'The records are chosen before the old ones are dropped, so nothing goes quiet. They can take a minute to appear.',
        newFooter:
            'Choosing records against your words needs a model configured to programme with. Without one the station plays its own rotation, which is the designed answer rather than a failure.',
        replan: 'Replan',
        goOnAir: 'Go on air',
        party: 'Party night',
        partyHint:
            'Fill in a request show for a crowd: three records after each request, a short wait between one guest’s requests, and room for more of them at once. Every field stays yours to change.',
    },
    order: {
        writer: {
            model: 'A model wrote these words.',
            deterministic:
                'The station wrote these words itself, from its own phrasings. That is the floor: it is also what you hear when a model is off, missing, or too slow.',
            other: 'Written by {{writer}}.',
        },
        skip: {
            notWritten: 'not written yet',
            notWrittenHint:
                'The station writes a break when it comes round, not when it plants it. Nothing has gone wrong and nothing is being skipped.',
            noAudio: 'no audio yet',
            noAudioHint:
                'The words are written and are being spoken now. It is heard if the audio arrives before the boundary does, and skipped if it does not.',
            willSkip: 'will skip',
            willSkipHint: 'This will be skipped: the segment is {{state}}.',
        },
        state: {
            handed: {
                label: 'handed over',
                hint: 'The player is holding this one. It can no longer be moved or removed, and it has not aired yet.',
            },
            airing: { label: 'on air', hint: 'The player says a listener is hearing this now.' },
            played: { label: 'played', hint: 'Heard, and behind us.' },
            skipped: {
                label: 'skipped',
                hint: 'The station passed over this one: a segment with no audio, or an item the player never started.',
            },
            unavailable: {
                label: 'unavailable',
                hint: 'The station could not get the audio for this record, so it was passed over. Its copy is benched until a sync sees it again — check the record in the catalog to see which provider is refusing it.',
            },
            removed: {
                label: 'removed',
                hint: 'You took this out. It stays in the order marked like this rather than disappearing, which is what stops the station planting another break into the same slot a minute later.',
            },
        },
        history: {
            played_one: '{{count}} played earlier',
            played_other: '{{count}} played earlier',
            skipped_one: '{{count}} skipped',
            skipped_other: '{{count}} skipped',
            both: '{{played}}, {{skipped}}',
            earlier: 'Earlier in this broadcast',
        },
        region: 'Running order. Use arrow keys to move within a row.',
        column: {
            title: 'Title',
            artists: 'Artists',
            album: 'Album',
            duration: 'Duration',
            rating: 'Rating',
        },
        backToAir: 'Back to what is on air',
        segment: 'segment',
        over: 'over the next record',
        mixedInHint: 'The station mixed this in because it sounds like the record before it. The playlist did not name it.',
        mixedIn: 'mixed in',
        followsRequestHint: 'The station chose this because it sounds like the listener request before it, on a request show.',
        followsRequest: 'after a request',
        skipToHint: 'Skips straight to this record: everything in front of it is passed over and what is on air is cut.',
        skipTo: 'Skip to {{title}}',
        playNextHint:
            'Moves this in front of everything the player is not already holding. Not necessarily the next thing heard: whatever has been handed over plays first.',
        playNext: 'Play {{title}} next',
        dropHint: 'Drop this item',
        drop: 'Drop {{title}}',
    },
} as const;
