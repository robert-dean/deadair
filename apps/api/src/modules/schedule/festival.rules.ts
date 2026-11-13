import { httpError } from '@maroonedsoftware/errors';
import { normalizeKey } from '#modules/catalog/catalog.keys.js';

/** One act on a festival's bill, as the station reads it. */
export interface FestivalAct {
    artist: string;
    /** The day they play, `YYYY-MM-DD`, when the bill says. */
    day?: string;
    headliner: boolean;
}

/** Where a festival was imported from. Absent for one an operator typed. */
export interface FestivalSource {
    pluginId: string;
    eventId: string;
}

/** A festival as the station reads it: everything a presenter may say, and nothing a service has to be asked for. */
export interface Festival {
    id: string;
    name: string;
    /** Inclusive, `YYYY-MM-DD`. */
    startsOn: string;
    endsOn: string;
    place?: string;
    url?: string;
    acts: FestivalAct[];
    source?: FestivalSource;
}

/** A festival as it is written. Its id is the repository's to mint. */
export type FestivalDraft = Omit<Festival, 'id'>;

/** Where a festival stands on the station's calendar: still to come, on now, or finished. */
export type FestivalState = 'upcoming' | 'on' | 'over';

/** The one comparison every reader of a festival's dates makes. Dates as `YYYY-MM-DD` compare as text. */
export function festivalState(festival: Pick<Festival, 'startsOn' | 'endsOn'>, today: string): FestivalState {
    if (today < festival.startsOn) return 'upcoming';
    if (today > festival.endsOn) return 'over';
    return 'on';
}

/** The station's today as `YYYY-MM-DD`, read on its own calendar. */
export function stationToday(now: number, zone: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** What an operator sent, before it is checked. The contract's shape, with every optional left optional. */
export interface FestivalBody {
    name: string;
    startsOn: string;
    endsOn: string;
    place?: string;
    url?: string;
    acts: readonly { artist: string; day?: string; headliner?: boolean }[];
}

/**
 * A festival as it will be stored, or a 400 saying what is wrong with it.
 *
 * Text is trimmed, a blank optional is absent, and a name on the bill twice is kept once, at its first
 * place, headlining if either listing said so: a pasted lineup repeats an act that plays two days, and
 * refusing the whole paste for it would be the console's problem handed to the operator. Two things are
 * refused rather than mended, because there is no right guess: dates the wrong way round, and an act's
 * day outside the festival's.
 */
export function festivalDraftOf(body: FestivalBody, source?: FestivalSource): FestivalDraft {
    const name = body.name.trim();
    if (name.length === 0) throw invalid('a festival needs a name');
    if (!isCalendarDate(body.startsOn) || !isCalendarDate(body.endsOn)) throw invalid("a festival's dates must be real days, as YYYY-MM-DD");
    if (body.endsOn < body.startsOn) throw invalid(`"${name}" ends on ${body.endsOn}, before it starts on ${body.startsOn}`);

    const acts: FestivalAct[] = [];
    const seen = new Map<string, number>();
    for (const act of body.acts) {
        const artist = act.artist.trim();
        if (artist.length === 0) continue;
        if (act.day !== undefined && (!isCalendarDate(act.day) || act.day < body.startsOn || act.day > body.endsOn)) {
            throw invalid(`${artist} is down to play on ${act.day}, which is not one of the festival's days`);
        }

        const key = normalizeKey(artist);
        const earlier = seen.get(key);
        if (earlier !== undefined) {
            if (act.headliner === true) acts[earlier] = { ...acts[earlier]!, headliner: true };
            continue;
        }
        seen.set(key, acts.length);
        acts.push({ artist, headliner: act.headliner === true, ...(act.day === undefined ? {} : { day: act.day }) });
    }

    const place = body.place?.trim();
    const url = body.url?.trim();
    return {
        name,
        startsOn: body.startsOn,
        endsOn: body.endsOn,
        ...(place === undefined || place.length === 0 ? {} : { place }),
        ...(url === undefined || url.length === 0 ? {} : { url }),
        acts,
        ...(source === undefined ? {} : { source }),
    };
}

/** Whether `YYYY-MM-DD` names a day that exists. The contract checks the shape; this checks the 31st of February. */
export function isCalendarDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const invalid = (message: string) => httpError(400).withDetails({ message });
