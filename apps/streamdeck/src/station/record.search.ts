import type { RequestsClient } from '@deadair/sdk';

import { recordFrom, rowLines } from '../actions/request.reading.js';
import type { FoundRecord, RecordsFound } from '../inspector/inspector.messages.js';
import { classify, describe } from './connection.failure.js';

/** The part of the station's SDK the settings panel's search uses. */
export type RecordSearch = Pick<RequestsClient, 'searchRequestableRecords'>;

/** How many records the panel lists: enough to tell two recordings of one title apart, few enough to read. */
export const SEARCH_LIMIT = 10;

/**
 * A search for the Request key's settings panel, answered as the panel shows it.
 *
 * `GET /requests/search` and never the library's, as the phone apps search: a record the desk would
 * refuse at the door is never offered, and what the music providers carry fills the room the
 * library leaves. The answer names the station it came from, so the panel saves the record against
 * it and a key moved to another station knows to ask for a new one.
 */
export async function searchRecords(q: string, requests: RecordSearch | undefined, origin: string | undefined): Promise<RecordsFound> {
    const query = q.trim();
    if (requests === undefined || origin === undefined) return { event: 'records', q, text: describe('unconfigured').sentence };
    if (query === '') return { event: 'records', q, text: 'Type a title or an artist.' };
    try {
        const { tracks } = await requests.searchRequestableRecords({ q: query.slice(0, 200), limit: SEARCH_LIMIT });
        const records = tracks.flatMap((track): FoundRecord[] => {
            const record = recordFrom(track);
            return record === undefined ? [] : [{ record, ...rowLines(track) }];
        });
        if (records.length === 0) return { event: 'records', q, text: 'Nothing the station could be asked for matches that.' };
        return { event: 'records', q, records, station: origin };
    } catch (error) {
        const failure = classify(error);
        // Not the generic sentence, which is about Skip and Stop: searching is a listener's call.
        const text = failure === 'forbidden' ? 'The station would not let this key search for records.' : describe(failure).sentence;
        return { event: 'records', q, text };
    }
}
