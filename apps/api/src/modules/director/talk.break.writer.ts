import { Injectable } from 'injectkit';
import { BreakWriter, type BreakTrack, type BreakWriteRequest, type WrittenBreak } from './break.writer.js';

/**
 * The station's own words for a talk break, written from the two records either side of it.
 *
 * Deterministic in the sense that matters: no network, no model, no clock, and no way to fail that
 * costs the station a break it could have had. It is the FLOOR under the writer seam rather than a
 * stepping stone toward the model. Every generator in the previous station fell back to something
 * shaped like this on any model failure, and that is what kept a rotation clock from stalling on a
 * host that had started answering at two tokens a second.
 *
 * What it is not is clever. It says what was playing and what is playing next, in one of a handful
 * of phrasings, and that is the whole of it. A DJ with an opinion is the model's job.
 */

/** The kind of segment this writes. The same string as `segments.kind`. */
export const TALK_BREAK_KIND = 'talkbreak';

/** What `segments.writer` records for anything written here. */
export const DETERMINISTIC_WRITER = 'deterministic';

/**
 * One phrasing.
 *
 * `opening` is the literal the script always begins with, and it is how a past script is recognised
 * as having used this phrasing. Matching on the opening rather than storing a template id is the
 * cheap answer that happens to be the right one: the opening is the part a listener actually hears
 * repeating, so two phrasings that differ only in their middle are correctly treated as the same
 * one, and nothing has to be written down anywhere to make it work.
 */
interface Phrasing {
    opening: string;
    /** Whether this phrasing can be used at all for the request. */
    applies(request: PhrasingInputs): boolean;
    say(request: PhrasingInputs): string;
}

interface PhrasingInputs {
    previous?: BreakTrack;
    next?: BreakTrack;
    station?: string;
}

const PHRASINGS: readonly Phrasing[] = [
    {
        opening: 'That was',
        applies: ({ previous }) => previous !== undefined,
        say: ({ previous, next }) =>
            next === undefined
                ? `That was ${spoken(previous!.title)}, from ${spoken(previous!.artist)}.`
                : `That was ${spoken(previous!.title)}, from ${spoken(previous!.artist)}. Now, here's ${spoken(next.artist)} with ${spoken(next.title)}.`,
    },
    {
        opening: 'You just heard',
        applies: ({ previous }) => previous !== undefined,
        say: ({ previous, next }) =>
            next === undefined
                ? `You just heard ${spoken(previous!.artist)}, with ${spoken(previous!.title)}.`
                : `You just heard ${spoken(previous!.artist)}, with ${spoken(previous!.title)}. Up next, ${spoken(next.title)} by ${spoken(next.artist)}.`,
    },
    {
        // The one that says the station's name, which is the reason a listener knows what they are
        // listening to. Only offered when the operator has actually set one.
        opening: 'This is',
        applies: ({ station }) => station !== undefined,
        say: ({ station, previous, next }) => {
            const parts = [`This is ${station}.`];
            if (previous !== undefined) parts.push(`${spoken(previous.title)} there, from ${spoken(previous.artist)}.`);
            if (next !== undefined) parts.push(`Coming up, ${spoken(next.artist)}, ${spoken(next.title)}.`);
            return parts.join(' ');
        },
    },
    // The two intro-only phrasings, and both are barred whenever there is a record BEHIND the break
    // as well. A break that leads into the next record while saying nothing about the one that just
    // finished has thrown away the half a listener was actually waiting for: knowing what that was
    // is the whole reason anybody wants a DJ over a shuffle.
    {
        opening: 'Coming up',
        applies: ({ previous, next }) => previous === undefined && next !== undefined,
        say: ({ next }) => `Coming up next, ${spoken(next!.title)}, from ${spoken(next!.artist)}.`,
    },
    {
        opening: "Here's",
        applies: ({ previous, next }) => previous === undefined && next !== undefined,
        say: ({ next }) => `Here's ${spoken(next!.artist)} with ${spoken(next!.title)}.`,
    },
];

@Injectable()
export class TalkBreakWriter extends BreakWriter {
    readonly kind = TALK_BREAK_KIND;
    readonly name = DETERMINISTIC_WRITER;

    async write(request: BreakWriteRequest): Promise<WrittenBreak | undefined> {
        const inputs: PhrasingInputs = {
            ...(request.previous === undefined ? {} : { previous: request.previous }),
            ...(request.next === undefined ? {} : { next: request.next }),
            ...(request.station === undefined ? {} : { station: request.station }),
        };

        const usable = PHRASINGS.filter(phrasing => phrasing.applies(inputs));
        // Nothing either side and no station name: there is no true sentence to be made out of
        // that, and inventing one is how a station ends up announcing a record it did not play.
        if (usable.length === 0) return undefined;

        const phrasing = choose(usable, request.recent ?? []);
        return { script: phrasing.say(inputs), label: labelFor(inputs) };
    }
}

/**
 * A phrasing that has not just been used, where one is available.
 *
 * Two rounds rather than one. The first drops everything heard in the whole recent window, which is
 * what stops a station of five phrasings cycling them in a way a listener can predict. When that
 * leaves nothing — a window longer than the number of phrasings that fit the request, which is the
 * ordinary case for a break with only a `next` — it falls back to avoiding just the last thing said,
 * because saying the same sentence TWICE RUNNING is the one repetition anybody actually notices.
 */
function choose(usable: readonly Phrasing[], recent: readonly string[]): Phrasing {
    const unheard = usable.filter(phrasing => !recent.some(script => opens(script, phrasing.opening)));
    if (unheard.length > 0) return sample(unheard);

    const last = recent[0];
    const notLast = last === undefined ? usable : usable.filter(phrasing => !opens(last, phrasing.opening));
    return sample(notLast.length > 0 ? notLast : usable);
}

const opens = (script: string, opening: string): boolean => script.trim().toLowerCase().startsWith(opening.toLowerCase());

/**
 * Random rather than round-robin, for the reason `BreakPlanner.choose` is: the order a list happens
 * to be written in is not a running order, and a station whose phrasings cycle in a fixed sequence
 * sounds like a tape loop even when no single one of them repeats.
 */
const sample = <T>(pool: readonly T[]): T => pool[Math.floor(Math.random() * pool.length)]!;

/** What the console and the mount call this break. Never the script. */
function labelFor({ previous, next }: PhrasingInputs): string {
    if (previous !== undefined && next !== undefined) return `Talk break: ${previous.title} into ${next.title}`;
    if (previous !== undefined) return `Back-announce: ${previous.title}`;
    if (next !== undefined) return `Intro: ${next.title}`;
    return 'Talk break';
}

/**
 * A title or a credit as it should be READ rather than as it is filed.
 *
 * Catalog metadata carries a lot that exists for shelving and nothing for speaking: a remaster year,
 * a deluxe-edition marker, the word "Mono". Read out loud by a DJ every fourth record it is the
 * single most obvious sign that nobody is actually talking, and it is the sort of thing the model
 * binding would also want done before it ever sees the words.
 *
 * Conservative on purpose. Only the suffixes that are unambiguously catalogue furniture are cut, and
 * only when something is left afterwards. A parenthetical that is part of the song stays: "(Don't
 * Fear) The Reaper" and anything featuring a second artist are both things a listener would notice
 * going missing.
 */
export function spoken(text: string): string {
    const furniture =
        /\b(remaster(ed)?|re-?master|deluxe|expanded|anniversary|mono|stereo|single version|album version|radio edit|bonus track|\d{4} mix)\b/i;

    let cleaned = text
        // "Title (2011 Remaster)" and "Title [Deluxe Edition]".
        .replace(/[([][^()[\]]*[)\]]/g, match => (furniture.test(match) ? '' : match))
        // "Title - 2011 Remaster", where the marker is hung off a dash instead.
        .replace(/\s[-–—]\s[^-–—]*$/, match => (furniture.test(match) ? '' : match))
        .replace(/\s{2,}/g, ' ')
        .trim();

    // Everything was furniture, which means the reading of it was wrong rather than the title.
    if (cleaned.length === 0) cleaned = text.trim();
    return cleaned;
}
