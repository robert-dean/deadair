import type { Festival, FestivalAct, FestivalInput, FestivalListing } from '@deadair/sdk';

/**
 * What the festival form holds. The bill is two boxes of text, one act per line, because a lineup is
 * something an operator pastes from a poster rather than builds a row at a time: the headliners, and
 * everybody else. A line may end with the day that act plays, after a comma or a bar
 * (`Wet Leg, 2027-05-08`), and only a date in that shape is read as one, so a name with a comma in it
 * ("Crosby, Stills, Nash & Young") stays a name.
 */
export interface FestivalDraft {
    name: string;
    startsOn: string;
    endsOn: string;
    place: string;
    url: string;
    headliners: string;
    acts: string;
    /** Where a festival started from, when it was looked up: sent once, with the first save. */
    source?: { pluginId: string; eventId: string };
}

export const BLANK_FESTIVAL: FestivalDraft = { name: '', startsOn: '', endsOn: '', place: '', url: '', headliners: '', acts: '' };

const DAY_SUFFIX = /^(.*?)\s*[,|]\s*(\d{4}-\d{2}-\d{2})\s*$/;

/** A box of lines as acts, blank lines dropped, each with the day it ends with when it ends with one. */
export function actsOfLines(text: string, headliner: boolean): FestivalAct[] {
    return text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
            const dated = DAY_SUFFIX.exec(line);
            const artist = (dated?.[1] ?? line).trim();
            return { artist, ...(dated?.[2] === undefined ? {} : { day: dated[2] }), ...(headliner ? { headliner: true } : {}) };
        })
        .filter(act => act.artist.length > 0);
}

/** Acts as a box of lines, the way {@link actsOfLines} reads them back. */
export function linesOfActs(acts: readonly FestivalAct[]): string {
    return acts.map(act => (act.day === undefined ? act.artist : `${act.artist}, ${act.day}`)).join('\n');
}

/** A saved festival as the form holds it. */
export function draftOfFestival(festival: Festival): FestivalDraft {
    return {
        name: festival.name,
        startsOn: festival.startsOn,
        endsOn: festival.endsOn,
        place: festival.place ?? '',
        url: festival.url ?? '',
        headliners: linesOfActs(festival.acts.filter(act => act.headliner === true)),
        acts: linesOfActs(festival.acts.filter(act => act.headliner !== true)),
    };
}

/** What the form sends: the headliners first, then everybody else, and an empty optional left out. */
export function inputOfFestivalDraft(draft: FestivalDraft): FestivalInput {
    const place = draft.place.trim();
    const url = draft.url.trim();
    return {
        name: draft.name.trim(),
        startsOn: draft.startsOn,
        // A one-day festival needs only its first day.
        endsOn: draft.endsOn === '' ? draft.startsOn : draft.endsOn,
        ...(place === '' ? {} : { place }),
        ...(url === '' ? {} : { url }),
        acts: [...actsOfLines(draft.headliners, true), ...actsOfLines(draft.acts, false)],
        ...(draft.source === undefined ? {} : { sourcePluginId: draft.source.pluginId, sourceEventId: draft.source.eventId }),
    };
}

/**
 * A looked-up festival as the form holds it, to be checked before it is saved. The service says who is
 * on the bill and not who headlines, so every act starts in the second box.
 */
export function draftOfListing(listing: FestivalListing): FestivalDraft {
    return {
        name: listing.name,
        startsOn: listing.startsOn,
        endsOn: listing.endsOn,
        place: listing.place ?? '',
        url: listing.url ?? '',
        headliners: '',
        acts: listing.acts.join('\n'),
        source: { pluginId: listing.pluginId, eventId: listing.eventId },
    };
}

/** Whether the form holds enough to save: a name and a first day. The station refuses the rest. */
export function canSaveFestival(draft: FestivalDraft): boolean {
    return draft.name.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(draft.startsOn);
}
