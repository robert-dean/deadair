import type { ListenerRequestCreate, RequestableTrack } from '@deadair/sdk';

import { fitLine } from '../display/key.title.js';

/** The Request action's id, as the manifest names it. Fixed the day it is published. */
export const REQUEST = 'radio.deadair.streamdeck.request';

/**
 * The record one Request key asks for, as the station's request search offered it.
 *
 * Exactly one of `trackId` and `source`, as `POST /requests` takes them: a record the station holds,
 * or one a music provider carries that the station takes in on the first press. The title and artist
 * are kept beside it because the key draws them and the station is asked nothing to do so.
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

/** What one Request key shows, and what pressing it would ask. */
export interface RequestView {
    /** The record's title and artist, or what the key needs before it can ask. */
    title: string;
    /** The key has nothing it could ask for: drawn faint, as nothing on it is live. */
    dim: boolean;
    /** The body a press sends. Absent on a key that refuses the press and asks nothing. */
    press?: ListenerRequestCreate;
}

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
 * A key with no record says so. A key whose record was found on another station refuses the press
 * and asks to be set again, rather than sending an id the station in use would read as a different
 * record or none: the operator moved the deck to another station, and the key cannot know what that
 * record is called there. With no station set up at all it says what every key says.
 */
export function requestView(settings: RequestSettings, origin: string | undefined): RequestView {
    const record = settings.record;
    if (origin === undefined) return { title: 'Set up', dim: true };
    if (record === undefined) return { title: 'Pick a\nrecord', dim: true };
    if (settings.station !== origin) return { title: 'Pick again', dim: true };
    const press: ListenerRequestCreate = record.trackId !== undefined ? { trackId: record.trackId } : { source: record.source! };
    return { title: requestTitle(record), dim: false, press };
}

/**
 * A search row as the settings panel lists it: the title, then what tells it from another recording
 * of the same title — the artist, the album, the year — and the provider, for a record the station
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

/** The record under the key, as the Now Playing key titles one: two lines, each cut to fit. */
export function requestTitle(record: Pick<RequestedRecord, 'title' | 'artist'>): string {
    return record.artist.trim() === '' ? fitLine(record.title) : `${fitLine(record.title)}\n${fitLine(record.artist)}`;
}
