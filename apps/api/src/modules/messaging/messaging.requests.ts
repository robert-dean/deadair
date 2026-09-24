import { Container, Injectable } from 'injectkit';
import type { OutgoingMessage } from '@maroonedsoftware/comms';
import type { InboundMessage } from '@deadair/plugin-sdk';
import { dedicationOf } from '#modules/requests/request.dedication.js';
import { RequestDesk, type Requester } from '#modules/requests/request.desk.js';
import { RequestsRepository, type Dedication, type RequestRow, type RequestableRow } from '#modules/requests/requests.repository.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { MessagingRepository } from './messaging.repository.js';

/** The action id a "which one did you mean" button carries, with the record's id as its value. */
export const REQUEST_PICK_ACTION = 'request.pick';

/** How many matches a chat is offered to choose between. Three fit on one row of buttons on every platform. */
const MAX_CHOICES = 3;

/** What the station says about a request, from the row the desk answered with. Exported for the tests. */
export function describeRequest(row: RequestRow): string {
    const record = `${row.title} by ${row.artist}`;
    switch (row.status) {
        case 'queued':
            return `Your request is in: ${record}, a few records from now.`;
        case 'pending':
            return `Got it: ${record}. It will be on in a little while.`;
        case 'waiting':
            return `Thanks. ${record} is waiting for the station to say yes.`;
        case 'aired':
            return `${record} has already played for you.`;
        case 'declined':
        case 'expired':
            return `Sorry: ${row.reason ?? 'the station cannot take that one.'}`;
    }
}

/** How long a dedication waits for its sender to press one of the "which one" buttons. */
export const CHOICE_TTL_MS = 10 * 60_000;

/** What `/request` was given: what to look for, and a dedication when there was one. */
export interface RequestArgs {
    query: string;
    dedication?: Dedication;
}

/**
 * `teardrop for Sam: happy birthday` as a search and a dedication.
 *
 * A dedication is recognised only with a colon, because " for " alone is in too many titles
 * ("Waiting for Tonight"). Before the colon, the LAST " for " splits the record from who it is for,
 * so a title with "for" in it still works; with no " for " the part before the colon is the record and
 * the message is for nobody in particular. Exported for the tests.
 */
export function parseRequestArgs(args: string): RequestArgs {
    const colon = args.indexOf(':');
    if (colon < 0) return { query: args.trim() };

    const head = args.slice(0, colon);
    const message = args.slice(colon + 1);
    const at = head.toLowerCase().lastIndexOf(' for ');
    const query = (at < 0 ? head : head.slice(0, at)).trim();
    const to = at < 0 ? undefined : head.slice(at + ' for '.length);
    const dedication = dedicationOf(to, message);
    return { query, ...(dedication === undefined ? {} : { dedication }) };
}

/** A match as a button label. */
const labelOf = (record: RequestableRow): string => `${record.title}, ${record.artist}`;

/**
 * `/request` on a chat platform: the chat side of the requests module.
 *
 * It finds the record and hands it to `RequestDesk.submit`, the same desk a listener app reaches
 * through the API, so the rules are the same wherever somebody asks from.
 *
 * ## Who is asking
 *
 * The platform's user id, as `chat:<plugin id>:<user id>`, unless that chat account is LINKED to a
 * station account, in which case it is the account: the one-at-a-time rule and the cooldown are then
 * the same person's whether they ask from the app or the chat.
 *
 * ## Which record
 *
 * One clear match (the only one, or one whose title is exactly what was typed) is asked for at once.
 * Several are offered as buttons, each carrying the record's id as its value, and a press asks for
 * that one. What somebody typed to find a record is only ever a search: it reaches the catalog as a
 * `LIKE` pattern and nothing else.
 *
 * ## A dedication
 *
 * `/request teardrop for Sam: happy birthday` (see {@link parseRequestArgs}). It rides the request to
 * the dedication writers, which say the names and put the message in their own words or leave it out;
 * nothing here repeats it.
 */
@Injectable()
export class MessagingRequests {
    /**
     * A dedication waiting for its sender to pick which record they meant. In memory and short-lived:
     * the buttons carry only the record's id, since a platform bounds what a button can carry, and a
     * restart costs somebody a dedication they can type again.
     */
    private readonly choices = new Map<string, { dedication: Dedication; until: number }>();

    constructor(private readonly container: Container) {}

    /** `/request <what>`. Answers with the message to send back. */
    async request(pluginId: string, message: InboundMessage, args: string): Promise<OutgoingMessage> {
        const { query, dedication } = parseRequestArgs(args);
        if (query === '') return { text: 'Tell me what you would like to hear: /request followed by a title, an artist, or both.' };

        return inScope(this.container, async scope => {
            const matches = await scope.get(RequestsRepository).search(query, MAX_CHOICES + 1);
            if (matches.length === 0) return { text: 'The station does not have anything matching that. Try the title, the artist, or both.' };

            const exact = matches.find(record => record.title.toLowerCase() === query.trim().toLowerCase());
            const clear = matches.length === 1 ? matches[0] : exact;
            if (clear !== undefined) return { text: describeRequest(await this.submit(scope, pluginId, message, clear, dedication)) };

            const key = choiceKey(pluginId, message);
            if (dedication === undefined) this.choices.delete(key);
            else this.choices.set(key, { dedication, until: Date.now() + CHOICE_TTL_MS });
            this.forgetStale();

            return {
                text: 'Which one did you mean?',
                buttons: matches.slice(0, MAX_CHOICES).map(record => ({ id: REQUEST_PICK_ACTION, label: labelOf(record), value: record.trackId })),
            };
        });
    }

    /** A press on one of the buttons `request` offered. Answers with the message to send back. */
    async pick(pluginId: string, message: InboundMessage, trackId: string | undefined): Promise<OutgoingMessage> {
        return inScope(this.container, async scope => {
            // The value came back from the platform, and a client can send any value it likes, so it
            // is looked up rather than trusted: an id that is not a record the station could play is
            // the same as no id at all.
            const record = trackId === undefined || !isUuid(trackId) ? undefined : await scope.get(RequestsRepository).findRequestable(trackId);
            if (record === undefined) return { text: 'That one is not available any more. Try /request again.' };

            // The dedication the sender typed with `/request`, if they typed one and it has not gone
            // stale. Keyed on the sender as well as the chat, so pressing somebody else's button in a
            // group asks for the record without taking their dedication.
            const key = choiceKey(pluginId, message);
            const waiting = this.choices.get(key);
            this.choices.delete(key);
            const dedication = waiting !== undefined && waiting.until > Date.now() ? waiting.dedication : undefined;
            return { text: describeRequest(await this.submit(scope, pluginId, message, record, dedication)) };
        });
    }

    private forgetStale(): void {
        const now = Date.now();
        for (const [key, choice] of this.choices) if (choice.until <= now) this.choices.delete(key);
    }

    private async submit(
        scope: Container,
        pluginId: string,
        message: InboundMessage,
        record: RequestableRow,
        dedication?: Dedication,
    ): Promise<RequestRow> {
        const actorId = await scope.get(MessagingRepository).linkedActor(pluginId, message.sender.id);
        const requester: Requester = {
            key: actorId === undefined ? `chat:${pluginId}:${message.sender.id}` : `user:${actorId}`,
            name: message.sender.displayName,
            ...(actorId === undefined ? {} : { actorId }),
            chat: { pluginId, chatId: message.chatId, chatKind: message.chatKind, messageId: message.id },
        };
        return scope.get(RequestDesk).submit(requester, record, dedication);
    }
}

const choiceKey = (pluginId: string, message: InboundMessage): string => `${pluginId}\u0000${message.chatId}\u0000${message.sender.id}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string): boolean => UUID.test(value);
