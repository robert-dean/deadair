import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { MessagingService } from './messaging.service.js';

/** One announcement to one chat. JSON-safe: it is a job payload. */
export interface AnnouncePayload {
    pluginId: string;
    chatId: string;
    text: string;
    /** Epoch milliseconds after which this is no longer true, and is dropped rather than sent. */
    notAfter: number;
}

/**
 * Tell one chat what the station is playing.
 *
 * Retried by pg-boss, not by a table, because a retry is only worth anything inside the record's own
 * length: {@link AnnouncePayload.notAfter} is when it stops playing, and past it the job drops the
 * announcement instead of sending a false one. A refusal the plugin says is permanent (a chat the bot
 * was removed from) is logged and dropped at once; one it says is worth retrying THROWS, which is
 * what hands it to the broker's retry.
 */
@Injectable()
export class MessagingAnnounceJob extends PlainJob<Partial<AnnouncePayload>> {
    constructor(
        private readonly messaging: MessagingService,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    // Partial, like every job payload here: what arrives is whatever the row holds.
    protected async execute(payload?: Partial<AnnouncePayload>): Promise<void> {
        const { pluginId, chatId, text, notAfter } = payload ?? {};
        if (typeof pluginId !== 'string' || typeof chatId !== 'string' || typeof text !== 'string' || typeof notAfter !== 'number') return;

        if (Date.now() > notAfter) {
            this.logger.debug('messaging: dropped an announcement whose record has finished', { pluginId });
            return;
        }

        const result = await this.messaging.send(pluginId, { chatId, text });
        if (result.delivered) return;

        if (result.retryable === true) throw new Error(`could not announce on ${pluginId}, will try again: ${result.reason ?? 'no reason given'}`);

        // At info: a chat that no longer takes the bot is the operator's to fix, in the plugin's list.
        this.logger.info(
            `messaging: a chat refused an announcement and will not be asked again for this record (${pluginId}: ${result.reason ?? 'no reason given'})`,
        );
    }
}
