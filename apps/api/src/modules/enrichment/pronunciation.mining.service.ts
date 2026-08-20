import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { readGloss } from '#modules/render/pronunciation.gloss.js';
import { PronunciationRepository, type PronunciationSubjectKind } from '#modules/render/pronunciation.repository.js';
import { errorText } from '#modules/shared/error.text.js';
import { FactRepository } from './fact.repository.js';

/** What one pass over the articles did, for the job's log line. */
export interface MiningSummary {
    /** Documents opened. */
    read: number;
    /** Entries the station will now say without being asked. */
    active: number;
    /** Entries waiting for somebody to look at them. */
    suggested: number;
    /** Documents that said nothing about how to say anything, which is most of them. */
    empty: number;
    failed: number;
}

const empty = (): MiningSummary => ({ read: 0, active: 0, suggested: 0, empty: 0, failed: 0 });

/**
 * Filling the station's lexicon out of articles it already holds.
 *
 * A plugin fetched the prose and the host stored it so that claims could be extracted from it; the
 * pronunciation key printed in the same opening sentence is a second thing worth having out of the
 * same bytes, and it costs no request to anybody. `readGloss` does the reading and this does the
 * bookkeeping around it.
 *
 * ## The order of the two writes is the interesting part
 *
 * The entry is written BEFORE the document is marked as read, which is the opposite of the way
 * `recordExtraction` lands claims and their mark together in one transaction. It has to be, because
 * these are two repositories and there is no one transaction to put them in — so the question is
 * only which way a crash between them should fail. Marked first, a proposal is lost for good and
 * nothing will ever look at that article again. Written first, the pass reads the article once more
 * and `holds` recognises what it already said. One of those is recoverable.
 *
 * ## Nothing is proposed twice, in any state
 *
 * {@link PronunciationRepository.holds} answers for `rejected` rows as well as live ones, which is
 * what makes turning a proposal down stick: a plugin handing over a fresh copy of the same article
 * under a new URL is a new document to the mark table and must not be a new proposal to the
 * operator.
 */
@Injectable()
export class PronunciationMiningService {
    constructor(
        private readonly facts: FactRepository,
        private readonly lexicon: PronunciationRepository,
        private readonly logger: Logger,
    ) {}

    /**
     * Read what the next few articles say about how to say their own names.
     *
     * Bounded like the lead pass and for its reasons: local rows, no model, no network, and each
     * document settles on its own so stopping is always legal.
     */
    async mine(limit: number, stop?: AbortSignal): Promise<MiningSummary> {
        const documents = await this.facts.listPendingDocuments('gloss', limit);
        const summary = empty();

        for (const document of documents) {
            if (stop?.aborted) break;

            try {
                const reading = readGloss(document.name, document.text);
                summary.read++;

                // Most articles say nothing about pronunciation. That is the ordinary answer rather
                // than a miss, and the mark is what stops it being asked again.
                if (reading === undefined || (await this.lexicon.holds(reading.written))) {
                    summary.empty++;
                    await this.facts.markRead(document, 'gloss', 0);
                    continue;
                }

                await this.lexicon.add({
                    written: reading.written,
                    spoken: reading.spoken,
                    state: reading.confident ? 'active' : 'suggested',
                    origin: 'gloss',
                    sourceUrl: document.url,
                    sourceQuote: reading.sourceQuote,
                    subjectKind: document.subject.type as PronunciationSubjectKind,
                    subjectId: document.subject.id,
                });

                await this.facts.markRead(document, 'gloss', 1);

                if (reading.confident) summary.active++;
                else summary.suggested++;

                this.logger.debug('pronunciations: an article said how to say a name', {
                    written: reading.written,
                    spoken: reading.spoken,
                    confident: reading.confident,
                });
            } catch (error) {
                // Reported and stepped over, as the lead pass does: the document keeps no mark, so
                // the next run picks it up. The work is its own record.
                summary.failed++;
                this.logger.warn(`pronunciations: could not read ${document.url} (${errorText(error)})`);
            }
        }

        return summary;
    }
}
