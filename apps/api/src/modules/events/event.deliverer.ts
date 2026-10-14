import { Container, Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { EventDestinationsRepository, type EventDestinationRow } from './event.destinations.repository.js';
import type { EventEnvelope } from './event.envelope.js';
import { WebhookSender } from './webhook.sender.js';

/** One event to one destination. JSON-safe: it is a job payload. */
export interface DeliverPayload {
    destinationId: string;
    envelope: EventEnvelope;
    /** Epoch milliseconds past which the event is false rather than late, and is dropped instead of sent. */
    notAfter: number;
    /**
     * Whether this is a STATE event: something going on air. A state event older than the newest one
     * the destination has taken is dropped, because the broker keeps no order; see the migration.
     */
    state: boolean;
}

/**
 * How many times the broker asks again after a first attempt fails. Four attempts in all, at
 * fifteen seconds and then backing off: about two minutes, which is inside most records and is the
 * length of a hub restarting for an update.
 */
export const DELIVER_RETRY_LIMIT = 3;

/** Deliveries in a row that did not arrive before the station turns a destination off. */
export const FAILURES_BEFORE_DISABLE = 20;

/** What one run of the job came to. */
export type DeliverOutcome = 'delivered' | 'failed' | 'dropped' | 'skipped';

/** Thrown to hand an attempt back to the broker, which is what a retry is. */
export class DeliveryRetry extends Error {}

/**
 * Delivers one event to one destination, once per run of `events.deliver`.
 *
 * ## A delivery is an event, not an attempt
 *
 * The broker retries an attempt that may yet arrive; this decides which attempt is the LAST, and only
 * the outcome of that one counts toward switching a destination off. So a hub that restarts for two
 * minutes costs one failure per event that fell in the gap, not four, and twenty in a row is a
 * receiver that is gone rather than one that blinked.
 *
 * ## Late is dropped, and so is stale
 *
 * Past `notAfter` the event is no longer true (the record has finished), so it is written down as
 * dropped and not sent; if an earlier attempt at it had already failed, that counts as the failure it
 * is. And a STATE event older than the newest the destination has taken is dropped too, since sending
 * it would put the receiver back into a state the station has already left.
 */
@Injectable()
export class EventDeliverer {
    constructor(
        // The ROOT container, for `inScope`: the repository and the key are scoped.
        private readonly container: Container,
        private readonly sender: WebhookSender,
        private readonly activity: ActivityRecorder,
        private readonly logger: Logger,
    ) {}

    async deliver(payload: DeliverPayload, signal?: AbortSignal, now: number = Date.now()): Promise<DeliverOutcome> {
        const { destinationId, envelope, notAfter, state } = payload;

        return inScope(this.container, async scope => {
            const repository = scope.get(EventDestinationsRepository);
            const destination = await repository.get(destinationId);

            // Deleted, turned off or no longer asking for this since the job was sent: nothing to say,
            // and nothing to write down, since the operator has already told the station to stop.
            if (destination === undefined || !destination.enabled) return 'skipped';
            if (destination.events.length > 0 && !destination.events.includes(envelope.type)) return 'skipped';

            const attempt = (await repository.attemptsAt(destinationId, envelope.id)) + 1;
            const logged = { destinationId, eventId: envelope.id, eventType: envelope.type, attempt };

            if (now > notAfter) {
                await repository.recordDelivery({
                    ...logged,
                    outcome: 'dropped',
                    durationMs: 0,
                    error: 'No longer true by the time it could be sent, so not sent.',
                });
                if (attempt > 1) await this.failed(repository, destination, 'Still failing when the event stopped being true.');
                return 'dropped';
            }

            if (state && destination.lastStateAt !== undefined && destination.lastStateAt > DateTime.fromISO(envelope.occurredAt)) {
                await repository.recordDelivery({
                    ...logged,
                    outcome: 'dropped',
                    durationMs: 0,
                    error: 'Something newer had already been delivered, so this was out of date.',
                });
                return 'dropped';
            }

            const secret = scope.get(EncryptionProvider).decrypt(destination.secretSealed);
            const result = await this.sender.send({ url: destination.url, secret }, envelope, signal);

            await repository.recordDelivery({
                ...logged,
                outcome: result.outcome,
                ...(result.httpStatus === undefined ? {} : { httpStatus: result.httpStatus }),
                durationMs: result.durationMs,
                ...(result.outcome === 'failed' ? { error: result.error } : {}),
            });

            if (result.outcome === 'delivered') {
                await repository.markDelivered(destinationId, state ? envelope.occurredAt : undefined);
                return 'delivered';
            }

            if (result.retryable && attempt <= DELIVER_RETRY_LIMIT)
                throw new DeliveryRetry(`event ${envelope.type} to ${destination.name}: ${result.error}`);

            await this.failed(repository, destination, result.error);
            return 'failed';
        });
    }

    /** One more failed delivery, and the destination switched off when that makes twenty in a row. */
    private async failed(repository: EventDestinationsRepository, destination: EventDestinationRow, reason: string): Promise<void> {
        const tally = await repository.markFailed(destination.id, reason);
        if (tally === undefined || !tally.enabled || tally.consecutiveFailures < FAILURES_BEFORE_DISABLE) return;
        if (!(await repository.disableFailing(destination.id))) return;

        this.logger.warn(`events: turned off the destination "${tally.name}" after ${tally.consecutiveFailures} failed deliveries in a row`);
        void this.activity.record({
            module: 'events',
            kind: 'destination.disabled',
            severity: 'warn',
            detail: `Turned off the event destination "${tally.name}" after ${tally.consecutiveFailures} deliveries in a row did not arrive. The last: ${reason}`,
            data: { destinationId: destination.id },
        });
    }
}
