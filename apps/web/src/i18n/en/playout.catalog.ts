/**
 * The transport's words: the tally light, why the station is silent, and the buttons that put a
 * playlist or a chart on air.
 */
export const playout = {
    silence: {
        /** Two words per gate, for the tally that sits under every page. */
        label: {
            airing: 'on air',
            transportStalled: 'transport stalled',
            controlDenied: 'stream refusing us',
            streamUnreachable: 'stream unreachable',
            configNotAdopted: 'config not adopted',
            stoodDown: 'off air',
            noProgramme: 'nothing to air',
            warmingUp: 'warming up',
            waitingOnAudio: 'records not here',
            noAudience: 'ready',
            notDriving: 'not driving',
            starved: 'off the running order',
        },
        /** A heading per gate, for the diagnosis panel. */
        title: {
            airing: 'On air',
            transportStalled: 'The transport loop has stopped',
            controlDenied: 'The stream is refusing the bridge secret',
            streamUnreachable: 'The stream is not reachable',
            configNotAdopted: 'A container is running config that was replaced',
            stoodDown: 'The station was stood down',
            noProgramme: 'There is nothing left to air',
            warmingUp: 'The station is fetching its first records',
            waitingOnAudio: 'The records are not here, and nothing is fetching them',
            noAudience: 'Waiting for a listener',
            notDriving: 'The mount is not being held',
            starved: 'The mount is airing the local bed',
        },
        onAirTitle: 'The station is on air',
        ruledOut: 'Ruled out',
        ruledOutCount: 'Ruled out ({{count}})',
        nobodyListening: 'nobody listening',
        listening_one: '{{count}} listening',
        listening_other: '{{count}} listening',
    },
    staleConfig: {
        badge: 'config not adopted',
        and: ' and ',
        tooltip_one: '{{containers}} is running config that has been replaced. Open the transport for the restart command.',
        tooltip_other: '{{containers}} are running config that has been replaced. Open the transport for the restart command.',
        title: 'A stream container is running config that has been replaced',
    },
    playlist: {
        failed: 'That playlist could not be aired.',
        failedLabel: 'Failed',
        air: 'Air this playlist',
        more: 'More ways to air this playlist',
        mixIn: 'Air with similar records mixed in',
        mixInHint: 'A record by an artist who sounds like one of its own, every few records. Needs a similarity plugin.',
    },
    chart: {
        order: {
            countdown: 'Countdown, ending on number one',
            ranked: 'Number one first',
            unordered: 'No fixed order',
        },
        orderLabel: 'Which way round to play the chart',
        failed: 'That chart could not be aired.',
        failedLabel: 'Failed',
        air: 'Air this chart',
        hint: 'Records the library has never held are fetched as they are needed, and air untrimmed until they have been measured. Looking a whole chart up takes a few minutes, so the station changes over once it has, and the feed says how it went.',
    },
} as const;
