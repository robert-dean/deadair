import type { BreakConcert } from './break.writer.js';

/**
 * How far ahead a show is worth mentioning: a listener can plan for two months, and a show next
 * summer is not news.
 */
const WINDOW_DAYS = 60;

const DAY_MS = 86_400_000;

/**
 * The dates a break may offer a show inside, on the station's own calendar.
 *
 * It starts TOMORROW, and that is the whole of this claim's freshness. A break is written hours
 * before it airs and its words cannot be re-cut, so a show tonight could be over by the slot, and a
 * date that is always at least tomorrow when written cannot pass inside the write-ahead window. A
 * show called off after the words were written is the one case left, and it is `perishable`'s kind
 * of exposure: as large as the plugin's cache and the write-ahead together.
 */
export function concertWindow(now: number, zone: string): { from: string; until: string } {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const midnight = Date.parse(`${today}T00:00:00Z`);
    const dated = (days: number): string => new Date(midnight + days * DAY_MS).toISOString().slice(0, 10);
    return { from: dated(1), until: dated(WINDOW_DAYS) };
}

/** A calendar date as a presenter says it: `Saturday, November 14`. Read as UTC so no zone can move the day. */
export function spokenConcertDate(startsOn: string): string {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(
        Date.parse(`${startsOn}T00:00:00Z`),
    );
}

/** One line of material about a record, in `describe`'s form. */
export function concertLine(artist: string, concert: BreakConcert): string {
    const town = concert.city === undefined ? '' : ` in ${concert.city}`;
    return (
        `- Upcoming show: ${artist} play ${concert.venue}${town} on ${concert.date}. This is true and the station checked it. ` +
        'You may mention it if it fits, saying that venue and that date exactly. Do not add a time, a price, tickets or anyone else on the bill.'
    );
}

/** Words that only make sense about a live show someone can go to. Measured at 1 in 3,230 aired breaks, so a refusal is rare. */
const SHOW_WORDS = /\b(?:tickets?|tour dates?|sold[- ]out|(?:upcoming|next) (?:show|gig|concert)|(?:comes?|coming) to town|in concert at)\b/i;

const MONTH_DAY = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}\b/gi;

/**
 * The sentence announcing a show this break was not handed, or undefined.
 *
 * Handed none, any sentence selling a show is the model's own. Handed one, a sentence that names the
 * venue or uses those words must carry the date it was given and no other.
 */
export function inventedConcertSentence(script: string, shows: readonly BreakConcert[]): string | undefined {
    for (const sentence of script.split(/(?<=[.!?])\s+/)) {
        const lower = sentence.toLowerCase();
        const about = shows.filter(show => lower.includes(show.venue.toLowerCase()));
        if (shows.length === 0) {
            if (SHOW_WORDS.test(sentence)) return sentence;
            continue;
        }
        if (about.length === 0 && !SHOW_WORDS.test(sentence)) continue;

        const dates = lower.match(MONTH_DAY) ?? [];
        if (dates.some(date => !shows.some(show => show.date.toLowerCase().includes(date)))) return sentence;
    }
    return undefined;
}
