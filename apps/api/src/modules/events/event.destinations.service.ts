import { randomBytes } from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { httpError } from '@maroonedsoftware/errors';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { DESTINATION_TEST, eventTypes, isSubscribable } from './event.catalogue.js';
import { EventDestinationsRepository, type EventDestinationRow } from './event.destinations.repository.js';
import { eventEnvelope, eventStation } from './event.envelope.js';
import type {
    EventDeliveryList,
    EventDestination,
    EventDestinationCreate,
    EventDestinationCreated,
    EventDestinationList,
    EventDestinationSecret,
    EventDestinationUpdate,
    EventTestResult,
    EventTypeList,
} from './types/events.types.js';
import { WebhookSender, webhookUrlProblem } from './webhook.sender.js';

/**
 * Marks a string as this station's destination secret, so a scanner, or a person, finding one in a
 * receiver's config can tell what it is.
 */
const SECRET_PREFIX = 'deadair_dest_';

/** A fresh signing secret: 32 random bytes, which is the HMAC-SHA256 key length. */
const mintSecret = (): string => `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;

/**
 * The operator's half of event destinations: adding, changing and removing them, minting their
 * secrets, and sending one a test event.
 *
 * The secret is minted here and shown in the clear exactly twice in its life, on creation and on
 * rotation. It is sealed with the station's root key rather than hashed because every delivery has
 * to sign with it.
 */
@Injectable()
export class EventDestinationsService {
    constructor(
        private readonly authz: AuthorizationContext,
        private readonly repository: EventDestinationsRepository,
        private readonly encryption: EncryptionProvider,
        private readonly sender: WebhookSender,
        private readonly identity: StationIdentity,
        private readonly config: AppConfig,
    ) {}

    async listTypes(): Promise<EventTypeList> {
        return { types: eventTypes(eventStation(this.identity, this.config)) };
    }

    async list(): Promise<EventDestinationList> {
        return { destinations: (await this.repository.list()).map(toDestination) };
    }

    async create(body: EventDestinationCreate): Promise<EventDestinationCreated> {
        const { actorId } = this.authz.requireUser();
        assertUsableUrl(body.url);
        const events = subscription(body.events);

        const secret = mintSecret();
        const row = await this.repository.create({
            name: body.name.trim(),
            url: body.url.trim(),
            secretSealed: this.encryption.encrypt(secret),
            enabled: body.enabled ?? true,
            events,
            createdBy: actorId,
        });
        return { ...toDestination(row), secret };
    }

    async update(id: string, body: EventDestinationUpdate): Promise<EventDestination> {
        if (body.url !== undefined) assertUsableUrl(body.url);
        const events = body.events === undefined ? undefined : subscription(body.events);

        const row = await this.repository.update(id, {
            ...(body.name === undefined ? {} : { name: body.name.trim() }),
            ...(body.url === undefined ? {} : { url: body.url.trim() }),
            ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
            ...(events === undefined ? {} : { events }),
        });
        return toDestination(row ?? notFound(id));
    }

    async remove(id: string): Promise<void> {
        if (!(await this.repository.remove(id))) notFound(id);
    }

    /** A new secret, in force at once: a receiver still holding the old one refuses the next delivery. */
    async rotateSecret(id: string): Promise<EventDestinationSecret> {
        const secret = mintSecret();
        const row = await this.repository.update(id, { secretSealed: this.encryption.encrypt(secret) });
        if (row === undefined) notFound(id);
        return { secret };
    }

    /**
     * Sends the destination a test event now and says what came back.
     *
     * Sent whether the destination is on or not, because checking a receiver BEFORE turning it on is
     * the obvious thing to want. Written to the delivery log like any other attempt, so the console
     * shows it in the same place as real traffic.
     */
    async test(id: string): Promise<EventTestResult> {
        const destination = (await this.repository.get(id)) ?? notFound(id);
        const envelope = eventEnvelope(DESTINATION_TEST, { destinationId: id }, eventStation(this.identity, this.config), DateTime.now());

        const delivery = await this.sender.send({ url: destination.url, secret: this.encryption.decrypt(destination.secretSealed) }, envelope);

        await this.repository.recordDelivery({
            destinationId: id,
            eventId: envelope.id,
            eventType: envelope.type,
            attempt: 1,
            outcome: delivery.outcome,
            ...(delivery.httpStatus === undefined ? {} : { httpStatus: delivery.httpStatus }),
            durationMs: delivery.durationMs,
            ...(delivery.outcome === 'failed' ? { error: delivery.error } : {}),
        });

        return {
            delivered: delivery.outcome === 'delivered',
            ...(delivery.httpStatus === undefined ? {} : { httpStatus: delivery.httpStatus }),
            durationMs: delivery.durationMs,
            ...(delivery.outcome === 'failed' ? { error: delivery.error } : {}),
        };
    }

    async listDeliveries(id: string): Promise<EventDeliveryList> {
        if ((await this.repository.get(id)) === undefined) notFound(id);
        const rows = await this.repository.listDeliveries(id);
        return { deliveries: rows.map(({ destinationId: _, ...row }) => row) };
    }
}

const toDestination = (row: EventDestinationRow): EventDestination => ({
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    events: row.events,
    consecutiveFailures: row.consecutiveFailures,
    ...(row.disabledReason === undefined ? {} : { disabledReason: row.disabledReason }),
    ...(row.lastDeliveredAt === undefined ? {} : { lastDeliveredAt: row.lastDeliveredAt }),
    ...(row.lastFailedAt === undefined ? {} : { lastFailedAt: row.lastFailedAt }),
    ...(row.lastFailure === undefined ? {} : { lastFailure: row.lastFailure }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

/**
 * The event types a destination asks for, checked against the catalogue and with repeats removed.
 * Absent or empty is every type. A name the station does not send is refused rather than stored,
 * because a typo kept would be a subscription that silently never fires.
 */
function subscription(events: readonly string[] | undefined): string[] {
    const wanted = [...new Set((events ?? []).map(type => type.trim()))];
    const unknown = wanted.filter(type => !isSubscribable(type));
    if (unknown.length > 0)
        throw httpError(400).withDetails({ message: `the station sends no event called ${unknown.map(type => `"${type}"`).join(', ')}` });
    return wanted;
}

function assertUsableUrl(url: string): void {
    const problem = webhookUrlProblem(url.trim());
    if (problem !== undefined) throw httpError(400).withDetails({ message: `the address ${problem}` });
}

function notFound(id: string): never {
    throw httpError(404).withDetails({ message: `no event destination "${id}"` });
}
