import type { ListenerRequestCreate, RequestableTrack } from '@deadair/sdk';

import { describe } from '../station/connection.failure.js';

/** The Request action's id, as the manifest names it. Fixed the day it is published. */
export const REQUEST = 'radio.deadair.streamdeck.request';

/**
 * The record one Request key asks for, as the station's request search offered it.
 *
 * Exactly one of `trackId` and `source`, as `POST /requests` takes them: a record the station holds,
 * or one a music provider carries that the station takes in on the first press. The title and artist
 * are kept beside it so the settings panel can say what the key asks for without asking the station.
 */
export type RequestedRecord = {
    trackId?: string;
    source?: { pluginId: string; externalId: string };
    title: string;
    artist: string;
};

/**
 * One Request key's own settings: which record, and which station it came from.
 *
 * Action settings rather than global ones, because every key asks for its own record, and nothing
 * here is a secret: an exported profile carries a track id and a title, which is what a shared
 * profile should. `station` is the origin the record was found on, because a track id names a record
 * on ONE station and another station's ids name other records, if they name anything.
 */
export type RequestSettings = {
    record?: RequestedRecord;
    station?: string;
};

/**
 * What one Request key shows, and what pressing it would ask.
 *
 * No title: the key is the icon alone, faint when it would refuse the press, and what it would say
 * about why goes to the log when it is pressed. A title the operator types in the Stream Deck app is
 * theirs and is never replaced.
 */
export type RequestView =
    /** A record of its own: a press asks for it. */
    | { dim: false; press: ListenerRequestCreate }
    /** No record of its own: a press opens the console's request dialog at this address, to choose one there. */
    | { dim: false; open: string }
    /** The key has nothing it could ask for: drawn faint, and `refusal` is the log's sentence for a press. */
    | { dim: true; refusal: string };

/**
 * The record a search row is saved as, keeping only what a press sends and the key draws.
 *
 * A row with neither id is no record anybody can ask for, so it saves as nothing.
 */
export function recordFrom(track: RequestableTrack): RequestedRecord | undefined {
    if (track.trackId !== undefined) return { trackId: track.trackId, title: track.title, artist: track.artist };
    if (track.source !== undefined) {
        return { source: { pluginId: track.source.pluginId, externalId: track.source.externalId }, title: track.title, artist: track.artist };
    }
    return undefined;
}

/** A key's settings, read without trusting them: they come back from a profile file anybody may have edited. */
export function requestSettingsFrom(settings: unknown): RequestSettings {
    const given = (typeof settings === 'object' && settings !== null ? settings : {}) as Record<string, unknown>;
    const record = given.record as Partial<RequestedRecord> | undefined;
    const station = typeof given.station === 'string' ? given.station : undefined;
    if (typeof record !== 'object' || record === null || typeof record.title !== 'string' || typeof record.artist !== 'string') {
        return station === undefined ? {} : { station };
    }
    const source = record.source;
    const kept: RequestedRecord | undefined =
        typeof record.trackId === 'string'
            ? { trackId: record.trackId, title: record.title, artist: record.artist }
            : typeof source?.pluginId === 'string' && typeof source.externalId === 'string'
              ? { source: { pluginId: source.pluginId, externalId: source.externalId }, title: record.title, artist: record.artist }
              : undefined;
    return { ...(kept === undefined ? {} : { record: kept }), ...(station === undefined ? {} : { station }) };
}

/**
 * What a Request key shows, given its settings and the station the plugin is talking to now.
 *
 * A key with no record opens the console's own request dialog, so the one key is both: a record
 * chosen once, or a choice made each time at the desk. A key whose record was found on another
 * station refuses the press, rather than sending an id the station in use would read as a different record or none: the
 * operator moved the deck to another station, and the key cannot know what that record is called
 * there. With no station set up at all it says what every key says.
 */
export function requestView(settings: RequestSettings, origin: string | undefined): RequestView {
    const record = settings.record;
    if (origin === undefined) return { dim: true, refusal: describe('unconfigured').sentence };
    if (record === undefined) return { dim: false, open: requestDialogAt(origin) };
    if (settings.station !== origin) {
        return {
            dim: true,
            refusal: `This Request key's record, “${record.title}”, was picked on another station. Open its settings and pick it again.`,
        };
    }
    const press: ListenerRequestCreate = record.trackId !== undefined ? { trackId: record.trackId } : { source: record.source! };
    return { dim: false, press };
}

/**
 * A search row as the settings panel lists it: the title, then what tells it from another recording
 * of the same title (the artist, the album, the year), and the provider, for a record the station
 * does not hold yet and would take in on the first press.
 */
export function rowLines(track: RequestableTrack): { title: string; by: string } {
    const parts = [track.artist, track.album, track.year === undefined ? undefined : String(track.year)];
    if (track.trackId === undefined && track.sourceName !== undefined) parts.push(`from ${track.sourceName}`);
    return { title: track.title, by: parts.filter((part): part is string => part !== undefined && part.trim() !== '').join(' · ') };
}

/** Whether a record found is the one a key already asks for. */
export function samePick(found: RequestedRecord, record: RequestedRecord | undefined): boolean {
    if (record === undefined) return false;
    if (record.trackId !== undefined) return found.trackId === record.trackId;
    return (
        found.trackId === undefined && found.source?.pluginId === record.source?.pluginId && found.source?.externalId === record.source?.externalId
    );
}

/**
 * The console's Desk with its request dialog open: `/?request=1`, which the Desk's route reads
 * (`apps/web/src/routes/index.tsx`) and takes back out of the address once the dialog is up.
 */
export function requestDialogAt(origin: string): string {
    return `${origin}/?request=1`;
}
