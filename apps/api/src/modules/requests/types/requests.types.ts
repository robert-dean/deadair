import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * A music provider's copy of a record the station has not taken in yet
 * generated from [RequestableSource](../../../../data/contracts/requests/requests.types.ck)
 */
export const RequestableSource = z.strictObject({
    pluginId: z.string().min(1).max(200).describe('The plugin that carries it'),
    externalId: z.string().min(1).max(400).describe("That plugin's own id for the record"),
});
export type RequestableSource = z.infer<typeof RequestableSource>;

/**
 * generated from [RequestStatus](../../../../data/contracts/requests/requests.types.ck)
 */
export const RequestStatus = z.enum(['waiting', 'pending', 'queued', 'aired', 'declined', 'expired']);
export type RequestStatus = z.infer<typeof RequestStatus>;

/**
 * generated from [RequestSource](../../../../data/contracts/requests/requests.types.ck)
 */
export const RequestSource = z.enum(['app', 'chat']);
export type RequestSource = z.infer<typeof RequestSource>;

/**
 * Turn a request down
 * generated from [ListenerRequestDecline](../../../../data/contracts/requests/requests.types.ck)
 */
export const ListenerRequestDecline = z.strictObject({
    reason: z.string().max(400).optional().describe('What to tell the listener. Omit for a plain no'),
});
export type ListenerRequestDecline = z.infer<typeof ListenerRequestDecline>;

/**
 * A party: the pass guests join with by scanning its QR code, for as long as it lasts
 * generated from [PartyPass](../../../../data/contracts/requests/requests.types.ck)
 */
export const PartyPass = z.strictObject({
    token: z
        .string()
        .max(200)
        .describe(
            "The pass itself. Put it after `#` on the station's `/party` page, as `/party#<token>`, and that address is what the QR code holds. Anyone holding it can join until the party ends, so show it only to the room",
        ),
    createdAt: _ZodDatetime.describe('When the party started'),
    expiresAt: _ZodDatetime.describe('When the pass stops letting guests in, and turns away every guest who joined with it'),
    guests: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('How many guests have joined with it'),
});
export type PartyPass = z.infer<typeof PartyPass>;

/**
 * Start a party
 * generated from [PartyStart](../../../../data/contracts/requests/requests.types.ck)
 */
export const PartyStart = z.strictObject({
    hours: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(24))
        .optional()
        .describe('How long the pass lasts. Six when omitted'),
});
export type PartyStart = z.infer<typeof PartyStart>;

/**
 * Join a party as a guest, with the pass from its QR code
 * generated from [PartyJoin](../../../../data/contracts/requests/requests.types.ck)
 */
export const PartyJoin = z.strictObject({
    token: z.string().min(1).max(200).describe("The pass, as it appears after `#` in the party page's address"),
});
export type PartyJoin = z.infer<typeof PartyJoin>;

/**
 * A guest's way in: send it as a bearer token on the request routes
 * generated from [PartyGuestSession](../../../../data/contracts/requests/requests.types.ck)
 */
export const PartyGuestSession = z.strictObject({
    accessToken: z
        .string()
        .describe('The bearer token. It lets a guest search for records, ask for one and see their own requests, and nothing else'),
    expiresAt: _ZodDatetime.describe("When it stops working, which is when the party's pass does"),
});
export type PartyGuestSession = z.infer<typeof PartyGuestSession>;

/**
 * A record the station could be asked for: one it holds, or one a music provider carries
 * generated from [RequestableTrack](../../../../data/contracts/requests/requests.types.ck)
 */
export const RequestableTrack = z.strictObject({
    trackId: z
        .uuid()
        .optional()
        .describe('What to send as `trackId` to make the request. Absent for a record from a provider, which is asked for by `source` instead'),
    source: RequestableSource.optional().describe('Where a record the station does not hold yet comes from. Send it as `source` to ask for it'),
    sourceName: z.string().max(200).optional().describe('The provider, as the station names it, for a record from one'),
    title: z.string().max(400),
    artist: z.string().max(400).describe('The lead artist'),
    album: z.string().max(400).optional(),
    year: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
});
export type RequestableTrack = z.infer<typeof RequestableTrack>;

/**
 * Ask the station to play a record
 * generated from [ListenerRequestCreate](../../../../data/contracts/requests/requests.types.ck)
 */
export const ListenerRequestCreate = z.strictObject({
    trackId: z.uuid().optional().describe('A record from the request search that the station holds. Send this or `source`, never both'),
    source: RequestableSource.optional().describe(
        'A record from the request search that a provider carries. The station takes it in, then decides on the request as usual',
    ),
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
 * A record somebody asked the station to play, and what became of it
 * generated from [ListenerRequest](../../../../data/contracts/requests/requests.types.ck)
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
    fromParty: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe('True when a guest at a party asked for it, through the party pass. Absent otherwise'),
    overrulable: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            'True on a declined request whoever asked may still insist on, with `POST /requests/{id}/insist`: the station turned it down for its own taste (aired lately, a cooldown, a dislike, the period, a length) rather than a rule nobody overrules. Absent otherwise, and once it has been insisted on',
        ),
    insisted: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            "True when whoever asked insisted on it after the station turned it down, so the station's own taste was overruled. Absent otherwise",
        ),
});
export type ListenerRequest = z.infer<typeof ListenerRequest>;

/**
 * The party, if one is on
 * generated from [PartyState](../../../../data/contracts/requests/requests.types.ck)
 */
export const PartyState = z.strictObject({
    party: PartyPass.optional().describe('Absent when no party is on'),
});
export type PartyState = z.infer<typeof PartyState>;

/**
 * Records matching a search, best matches first, the station's own before any a provider carries
 * generated from [RequestableTrackList](../../../../data/contracts/requests/requests.types.ck)
 */
export const RequestableTrackList = z.strictObject({
    tracks: z.array(RequestableTrack),
});
export type RequestableTrackList = z.infer<typeof RequestableTrackList>;

/**
 * Requests, newest first
 * generated from [ListenerRequestList](../../../../data/contracts/requests/requests.types.ck)
 */
export const ListenerRequestList = z.strictObject({
    requests: z.array(ListenerRequest),
});
export type ListenerRequestList = z.infer<typeof ListenerRequestList>;
