import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * A record the station holds and could be asked for
 * generated from [RequestableTrack](../../../../data/contracts/requests/requests.types.ck#L7)
 */
export const RequestableTrack = z.strictObject({
    trackId: z.uuid().describe('What to send as `trackId` to make the request'),
    title: z.string().max(400),
    artist: z.string().max(400).describe('The lead artist'),
    album: z.string().max(400).optional(),
    year: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
});
export type RequestableTrack = z.infer<typeof RequestableTrack>;

/**
 * generated from [RequestStatus](../../../../data/contracts/requests/requests.types.ck#L19)
 */
export const RequestStatus = z.enum(['waiting', 'pending', 'queued', 'aired', 'declined', 'expired']);
export type RequestStatus = z.infer<typeof RequestStatus>;

/**
 * generated from [RequestSource](../../../../data/contracts/requests/requests.types.ck#L21)
 */
export const RequestSource = z.enum(['app', 'chat']);
export type RequestSource = z.infer<typeof RequestSource>;

/**
 * Ask the station to play a record
 * generated from [ListenerRequestCreate](../../../../data/contracts/requests/requests.types.ck#L41)
 */
export const ListenerRequestCreate = z.strictObject({
    trackId: z.uuid().describe('A record from the request search'),
    name: z
        .string()
        .min(1)
        .max(60)
        .optional()
        .describe('What the station should call you. Omitted, you are "a listener": your account\'s email address is never shown or read out'),
    dedicateTo: z.string().min(1).max(60).optional().describe('Dedicate it to somebody. The station may say this name on air'),
    message: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
            'A few words to go with it. The presenter may put them in their own words on air, and leaves out anything unfit to broadcast; the words themselves are never read out',
        ),
});
export type ListenerRequestCreate = z.infer<typeof ListenerRequestCreate>;

/**
 * Turn a request down
 * generated from [ListenerRequestDecline](../../../../data/contracts/requests/requests.types.ck#L48)
 */
export const ListenerRequestDecline = z.strictObject({
    reason: z.string().max(400).optional().describe('What to tell the listener. Omit for a plain no'),
});
export type ListenerRequestDecline = z.infer<typeof ListenerRequestDecline>;

/**
 * Records matching a search, best matches first
 * generated from [RequestableTrackList](../../../../data/contracts/requests/requests.types.ck#L15)
 */
export const RequestableTrackList = z.strictObject({
    tracks: z.array(RequestableTrack),
});
export type RequestableTrackList = z.infer<typeof RequestableTrackList>;

/**
 * A record somebody asked the station to play, and what became of it
 * generated from [ListenerRequest](../../../../data/contracts/requests/requests.types.ck#L23)
 */
export const ListenerRequest = z.strictObject({
    id: z.uuid(),
    status: RequestStatus.describe(
        '`waiting` for an operator to approve it, `pending` while its audio is fetched or a place is found for it, `queued` in the running order, `aired` once heard, `declined` or `expired` when it never will be',
    ),
    title: z.string().max(400).describe('The record, as it was called when it was asked for'),
    artist: z.string().max(400),
    requesterName: z.string().max(200).describe('Who asked, by the name their account or chat platform gave'),
    source: RequestSource.describe('Whether it came from an app or a chat platform'),
    createdAt: _ZodDatetime.describe('When it was asked for'),
    reason: z.string().max(400).optional().describe("Why it was declined or expired, in the station's words or an operator's"),
    airedAt: _ZodDatetime.optional().describe('When it aired'),
    dedicateTo: z.string().max(60).optional().describe('Who the listener dedicated it to'),
    message: z.string().max(200).optional().describe('What the listener asked to have said with it, in their own words'),
});
export type ListenerRequest = z.infer<typeof ListenerRequest>;

/**
 * Requests, newest first
 * generated from [ListenerRequestList](../../../../data/contracts/requests/requests.types.ck#L37)
 */
export const ListenerRequestList = z.strictObject({
    requests: z.array(ListenerRequest),
});
export type ListenerRequestList = z.infer<typeof ListenerRequestList>;
