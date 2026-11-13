import { normalizeKey } from '#modules/catalog/catalog.keys.js';
import { festivalState, stationToday, type Festival } from '#modules/schedule/festival.rules.js';
import { artistCreditsOverlap } from './rotation.keys.js';

/**
 * What a talk break on a festival show is handed about the festival: every word of it from the stored
 * row, so a presenter can talk about the festival without a date anybody had to guess.
 *
 * Only while the festival is still to come or on, on the station's calendar at the instant the break
 * will be HEARD. A finished festival is handed nothing: the show may still play its bill, but "it's this
 * weekend" about last weekend is the claim this whole file is for.
 */
export interface BreakFestival {
    /** As the operator wrote it, which is how it is said. */
    name: string;
    /** The first and last day as `YYYY-MM-DD`, for the guard. */
    startsOn: string;
    endsOn: string;
    /** The dates as a presenter says them: `Friday, May 7` or `Friday, May 7 to Sunday, May 9`. */
    dates: string;
    place?: string;
    /** Whether it is on when the break is heard, as opposed to still to come. */
    on: boolean;
    /** Who tops the bill, in the bill's order, at most {@link MAX_HEADLINERS}. */
    headliners: readonly string[];
    /** Every act on the bill, for the guard: a sentence putting anybody else at the festival is refused. */
    acts: readonly string[];
}

/** A record's place on the bill of the show's festival, on the neighbour whose artist is on it. */
export interface BreakFestivalSlot {
    /** The day they play, as a presenter says it, when the bill says. */
    day?: string;
}

/** How many headliners a break is told. A poster's top line, not its whole. */
const MAX_HEADLINERS = 3;

/**
 * The festival as a break may talk about it, or `undefined` once it is over at the instant the break is
 * heard. `heardAt` is the break's own slot when it has one, so a break written at ten to midnight on the
 * festival's last night is judged against the day it airs on.
 */
export function breakFestivalOf(festival: Festival, heardAt: number, zone: string): BreakFestival | undefined {
    const state = festivalState(festival, stationToday(heardAt, zone));
    if (state === 'over') return undefined;

    return {
        name: festival.name,
        startsOn: festival.startsOn,
        endsOn: festival.endsOn,
        dates: spokenDateRange(festival.startsOn, festival.endsOn),
        ...(festival.place === undefined ? {} : { place: festival.place }),
        on: state === 'on',
        headliners: festival.acts
            .filter(act => act.headliner)
            .slice(0, MAX_HEADLINERS)
            .map(act => act.artist),
        acts: festival.acts.map(act => act.artist),
    };
}

/** Where a record's artist is on the festival's bill, or `undefined` when they are not on it. Matched as whole acts, so a band's member's solo record is not the band. */
export function festivalSlotOf(festival: Festival, artist: string): BreakFestivalSlot | undefined {
    const wanted = normalizeKey(artist);
    const act = festival.acts.find(candidate => normalizeKey(candidate.artist) === wanted || artistCreditsOverlap(candidate.artist, artist));
    if (act === undefined) return undefined;
    return act.day === undefined ? {} : { day: spokenDay(act.day) };
}

/** A calendar date as a presenter says it: `Saturday, May 8`. Read as UTC so no zone can move the day. */
export function spokenDay(isoDate: string): string {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(
        Date.parse(`${isoDate}T00:00:00Z`),
    );
}

/** `Friday, May 7` for one day, `Friday, May 7 to Sunday, May 9` for several. */
export function spokenDateRange(startsOn: string, endsOn: string): string {
    return startsOn === endsOn ? spokenDay(startsOn) : `${spokenDay(startsOn)} to ${spokenDay(endsOn)}`;
}

/** One block of material about the festival, in `describe`'s form, for the user turn of a talk break. */
export function festivalLines(festival: BreakFestival): string {
    const where = festival.place === undefined ? '' : ` at ${festival.place}`;
    const when = festival.on ? `It is on now, ${festival.dates}` : `It runs ${festival.dates}`;
    const top = festival.headliners.length === 0 ? '' : ` Headlining: ${festival.headliners.join(', ')}.`;
    return (
        `This show is built around a festival: ${festival.name}${where}. ${when}.${top} ` +
        'This is true and the station checked it. You may mention it if it fits, saying those dates exactly. ' +
        'Do not add set times, prices, tickets, or anyone you were not told is on the bill.'
    );
}

/** One line of material about a record whose artist is on the bill, in `describe`'s form. */
export function festivalSlotLine(artist: string, festivalName: string, slot: BreakFestivalSlot): string {
    return slot.day === undefined
        ? `- On the bill at ${festivalName}: ${artist} play it`
        : `- On the bill at ${festivalName}: ${artist} play it on ${slot.day}`;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const;

const MONTH_DAY = new RegExp(`\\b(${MONTHS.join('|')}) (\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi');

/** Every day of the festival as `may 7`, which is what a sentence's dates are compared against. */
function festivalDays(festival: Pick<BreakFestival, 'startsOn' | 'endsOn'>): Set<string> {
    const days = new Set<string>();
    const end = Date.parse(`${festival.endsOn}T00:00:00Z`);
    for (let at = Date.parse(`${festival.startsOn}T00:00:00Z`); at <= end && days.size < 400; at += 86_400_000) {
        const date = new Date(at);
        days.add(`${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`);
    }
    return days;
}

/**
 * The sentence that says something about the festival it was not handed, or `undefined`.
 *
 * Only a sentence that NAMES the festival is read, since that is the one a listener takes as the
 * station's word about it. Two things in one are refused: a month and day that is not one of the
 * festival's own days, and putting a record's artist at the festival when they are not on its bill
 * (`neighbours`, the artists of the records either side, which are the ones a presenter reaches for).
 * The name is matched case-insensitively and with any leading "the" dropped, so "the Newport Folk
 * Festival" stored and "Newport Folk Festival" said are one festival.
 */
export function inventedFestivalSentence(script: string, festival: BreakFestival, neighbours: readonly string[]): string | undefined {
    const name = normalizeKey(festival.name).replace(/^the /, '');
    if (name.length === 0) return undefined;
    const days = festivalDays(festival);

    for (const sentence of script.split(/(?<=[.!?])\s+/)) {
        const words = ` ${normalizeKey(sentence)} `;
        if (!words.includes(` ${name} `)) continue;

        for (const match of sentence.matchAll(MONTH_DAY)) {
            const said = `${match[1]!.toLowerCase()} ${Number(match[2])}`;
            if (!days.has(said)) return sentence;
        }

        for (const artist of neighbours) {
            const key = normalizeKey(artist);
            if (key.length === 0 || !words.includes(` ${key} `)) continue;
            const onBill = festival.acts.some(act => normalizeKey(act) === key || artistCreditsOverlap(act, artist));
            if (!onBill) return sentence;
        }
    }
    return undefined;
}
