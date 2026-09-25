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
    host: {
        failed: 'The host could not be changed.',
        presentedBy: 'Presented by {{host}}',
        nobody: 'nobody',
        hint: 'Who presents this show. Changing it re-writes the breaks already written for it, and one that is not ready when its slot comes round is skipped.',
        stationsHost: 'The station’s host',
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
            'Everything still to come is dropped and the station programmes that stretch again. What is playing, and what the player is already holding, keeps going.',
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
        skipToHint: 'Skips straight to this record: everything in front of it is passed over and what is on air is cut.',
        skipTo: 'Skip to {{title}}',
        playNextHint:
            'Moves this in front of everything the player is not already holding. Not necessarily the next thing heard: whatever has been handed over plays first.',
        playNext: 'Play {{title}} next',
        dropHint: 'Drop this item',
        drop: 'Drop {{title}}',
    },
} as const;
