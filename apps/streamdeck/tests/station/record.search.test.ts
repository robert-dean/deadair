import { SdkError } from '@deadair/sdk';
import { describe, expect, it, vi } from 'vitest';

import { searchRecords, SEARCH_LIMIT, type RecordSearch } from '../../src/station/record.search.js';

const ORIGIN = 'https://radio.example.com';
const track = { trackId: 'b2c4d6e8-0000-4000-8000-000000000001', title: 'Pale Blue Eyes', artist: 'The Velvet Underground' };

const search = (answer: () => Promise<{ tracks: (typeof track)[] }>): RecordSearch => ({ searchRequestableRecords: vi.fn(answer) });

describe('searchRecords', () => {
    it('asks the request search and names the station the records came from', async () => {
        const requests = search(async () => ({ tracks: [track] }));
        await expect(searchRecords('  pale blue ', requests, ORIGIN)).resolves.toEqual({
            event: 'records',
            q: '  pale blue ',
            records: [{ record: track, title: 'Pale Blue Eyes', by: 'The Velvet Underground' }],
            station: ORIGIN,
        });
        expect(requests.searchRequestableRecords).toHaveBeenCalledWith({ q: 'pale blue', limit: SEARCH_LIMIT });
    });

    it('says so when nothing matches', async () => {
        const answer = await searchRecords(
            'zzz',
            search(async () => ({ tracks: [] })),
            ORIGIN,
        );
        expect(answer).toEqual({ event: 'records', q: 'zzz', text: 'Nothing the station could be asked for matches that.' });
    });

    it('asks nothing for an empty search, or with no station set up', async () => {
        const requests = search(async () => ({ tracks: [track] }));
        expect(await searchRecords('  ', requests, ORIGIN)).toMatchObject({ text: 'Type a title or an artist.' });
        expect(await searchRecords('pale', undefined, undefined)).toMatchObject({ text: expect.stringMatching(/No station yet/) });
        expect(requests.searchRequestableRecords).not.toHaveBeenCalled();
    });

    it('answers a failure with the sentence for it', async () => {
        const answer = await searchRecords(
            'pale',
            search(async () => Promise.reject(new SdkError(401, 'Unauthorized', {}, new Headers()))),
            ORIGIN,
        );
        expect(answer).toMatchObject({ text: expect.stringMatching(/refused the API key/) });
    });
});
