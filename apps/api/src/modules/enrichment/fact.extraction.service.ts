import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { leadClaims } from './fact.lead.js';
import { FactRepository, type FactWrite, type PendingDocument } from './fact.repository.js';
import { errorText } from '#modules/shared/error.text.js';

/** One pass of the extractor, for the job's log line. */
export interface ExtractionSummary {
    /** Documents this pass read. */
    read: number;
    /** Claims written. Lower than `read` on any real corpus, and zero is an ordinary answer. */
    written: number;
    /** Documents that produced nothing. Recorded as read all the same, so they are not read again. */
    empty: number;
    failed: number;
}

const empty = (): ExtractionSummary => ({ read: 0, written: 0, empty: 0, failed: 0 });

/**
 * Turning stored prose into claims the station can stand behind.
 *
 * The pass this service runs is the deterministic one: an article's opening
 * sentences, taken verbatim, with the quote and the claim being the same span
 * (`fact.lead.ts` argues why that needs no model and no verification). It is
 * the FLOOR, and the reason it exists as its own pass is that a station with no
 * model plugin — or one whose single model slot is busy writing a break — still
 * fills its fact store.
 *
 * Each document settles on its own, in its own transaction, so a pass that
 * stops halfway has still banked everything it read. That is what makes the
 * budget a legal place to stop rather than a rollback.
 */
@Injectable()
export class FactExtractionService {
    constructor(
        private readonly facts: FactRepository,
        private readonly logger: Logger,
    ) {}

    /**
     * Read up to `limit` unread documents, stopping early if the walk is told
     * to.
     *
     * A document that yields nothing is still MARKED as read. That is the whole
     * reason `fact_extractions` exists: plenty of articles carry no sentence
     * this station would say, and without the mark the pass cannot tell one of
     * those from an article it has never opened, so it re-reads them forever.
     */
    async extractLead(limit: number, stop?: AbortSignal): Promise<ExtractionSummary> {
        const documents = await this.facts.listPendingDocuments('lead', limit);
        const summary = empty();

        for (const document of documents) {
            if (stop?.aborted) break;

            try {
                const written = await this.facts.recordExtraction(document, 'lead', this.claimsFor(document));
                summary.read++;
                summary.written += written;
                if (written === 0) summary.empty++;
            } catch (error) {
                // Reported and stepped over. The document keeps no mark, so the
                // next pass picks it up: the work is its own record, exactly as
                // it is for the enrichment walk.
                summary.failed++;
                this.logger.warn(`facts: could not read ${document.url} (${errorText(error)})`);
            }
        }

        return summary;
    }

    /**
     * One document's claims, in the shape the store takes them.
     *
     * `category` is `summary` for every one of these and not a guess: a lead
     * sentence says what a record IS, which is exactly one of the categories and
     * never any of the others. Deciding that a sentence is about a film
     * placement or a chart run is a judgement, and this pass deliberately makes
     * none.
     */
    private claimsFor(document: PendingDocument): FactWrite[] {
        return leadClaims(document).map(found => ({
            subject: document.subject,
            claim: found.claim,
            category: 'summary' as const,
            source: 'lead' as const,
            sourceProvider: document.provider,
            sourceUrl: document.url,
            sourceQuote: found.sourceQuote,
        }));
    }
}
