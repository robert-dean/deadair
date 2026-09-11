import activity from '@site/static/img/console/activity.webp';
import catalogTrack from '@site/static/img/console/catalog.track.webp';
import catalogTracks from '@site/static/img/console/catalog.tracks.webp';
import charts from '@site/static/img/console/charts.webp';
import checkup from '@site/static/img/console/checkup.webp';
import deskNeon from '@site/static/img/console/desk.neon.webp';
import desk from '@site/static/img/console/desk.webp';
import deskWhite from '@site/static/img/console/desk.white.webp';
import plugins from '@site/static/img/console/plugins.webp';
import scheduleToday from '@site/static/img/console/schedule.today.webp';
import settingsAppearance from '@site/static/img/console/settings.appearance.webp';
import settingsLlm from '@site/static/img/console/settings.llm.webp';
import voiceCharacters from '@site/static/img/console/voice.characters.webp';
import voiceProductions from '@site/static/img/console/voice.productions.webp';
import voiceSaid from '@site/static/img/console/voice.said.webp';

/** One screenshot of the console, and what somebody who cannot see it should be told it shows. */
export interface ConsoleShot {
    src: string;
    alt: string;
}

/**
 * Every screenshot the front page uses, in one place.
 *
 * They are taken by `scripts/console.capture.mjs` from a running station, at 1440 by 900 and saved
 * at 1920 wide, so every one of them has the same shape and the size below is true of all of them.
 * Imported rather than named by path so a screenshot that is renamed or deleted fails the build.
 */
export const SHOT_WIDTH = 1920;
export const SHOT_HEIGHT = 1200;

export const shots = {
    desk: { src: desk, alt: 'The Desk: the record on air with its playhead, one thing that needs the operator, and the running order below.' },
    deskWhite: { src: deskWhite, alt: 'The same Desk in the Studio White theme: paper, ink and a serif masthead.' },
    deskNeon: { src: deskNeon, alt: 'The same Desk in the Neon Transmitter theme: neon yellow and cyan on teal-black.' },
    scheduleToday: { src: scheduleToday, alt: 'Programme, Today: the format clock, a dial with a weather band at five past and news at half past.' },
    voiceSaid: {
        src: voiceSaid,
        alt: 'What it said: every break written and every one declined, each with its writer and, for a declined one, the reason.',
    },
    catalogTrack: {
        src: catalogTrack,
        alt: 'One record in the library: where its copies come from, its cue points and loudness, when it has played, and what is known about it.',
    },
    voiceCharacters: { src: voiceCharacters, alt: 'Voice, Characters: who is presenting now, and the roster of hosts with their styles and voices.' },
    voiceProductions: {
        src: voiceProductions,
        alt: 'Voice, Productions: phone-ins the station wrote for itself, each with its state, its length and its cast.',
    },
    checkup: { src: checkup, alt: 'Check-up: whether the station is on air and why, what needs somebody, and the loops that keep it running.' },
    catalogTracks: {
        src: catalogTracks,
        alt: 'The library: how many records are ready to air, and every track with its state and the station’s rating.',
    },
    plugins: { src: plugins, alt: 'The plugins: a card per plugin with what it brings, whether it is running, and its settings.' },
    activity: { src: activity, alt: 'The activity feed: what aired, what was written and spoken, and every break that fell through, newest first.' },
    settingsLlm: { src: settingsLlm, alt: 'Settings, Words: which model writes the breaks, which one chooses the records, and which one reads.' },
    settingsAppearance: { src: settingsAppearance, alt: 'Settings, Appearance: the three themes the console can wear.' },
    charts: { src: charts, alt: 'Charts: what Last.fm listeners are playing, ready to be aired as a countdown.' },
} satisfies Record<string, ConsoleShot>;

export type ShotId = keyof typeof shots;
