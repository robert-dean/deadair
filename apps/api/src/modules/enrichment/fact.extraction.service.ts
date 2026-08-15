import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { LlmService } from '#modules/llm/llm.service.js';
import { leadClaims } from './fact.lead.js';
import { extractPrompt, readClaims, verified, verifyPrompt, type ExtractionSubject } from './fact.model.js';
import { FactRepository, type FactSubjectType, type FactWrite, type PendingDocument } from './fact.repository.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * The model pass's settings, keyed like every other model-driven feature.
 *
 * Off by default, and that is the honest default rather than a cautious one:
 * this walks every article on the install through two generations each, against
 * one model slot that a break writer needs in seconds. An operator turning it on
 * is accepting days of background work, and should do so on purpose.
 */
export const MODEL_FACTS_KEYS = {
    enabled: 'llm.factExtraction',
    model: 'llm.factModel',
} as const;

/**
 * How long the model pass may hold the slot before it gives up on one document.
 *
 * The whole reason this is bounded rather than patient: `LlmGate` serializes on
 * one set of weights, and a break writer that cannot get in falls through to the
 * station's own phrasings. A background walk must never be the thing that made
 * that happen — so it waits briefly, and a document it could not get to is
 * simply still outstanding.
 */
export const MODEL_WAIT_MS = 5_000;

/** How long one document's extraction may take once it has the slot. */
export const MODEL_BUDGET_MS = 120_000;

/** How long a verification may take. Far shorter: it is a yes or a no about two short strings. */
export const VERIFY_BUDGET_MS = 30_000;

/** The words the extraction prompt uses for each level. */
const SUBJECT_KIND: Record<FactSubjectType, ExtractionSubject['kind']> = { track: 'song', album: 'record', artist: 'artist' };

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
        private readonly llm: LlmService,
        private readonly config: AppConfig,
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
     * The pass on top: what a model finds that a lead sentence cannot carry.
     *
     * Purely additive, and every way it can decline is an ordinary state rather
     * than a fault. The setting is off, or there is no model plugin, or the slot
     * is busy with a break, or the answer came back unparseable — all four leave
     * a store the floor has already filled and a document still outstanding for
     * the next pass. None of them costs the station anything on air, which is
     * the property that makes it safe to point at a slow local model.
     */
    async extractModel(limit: number, stop?: AbortSignal): Promise<ExtractionSummary> {
        const summary = empty();

        // Read per pass rather than held, so an operator turning it on gets it
        // on the next run without a restart.
        if (!this.config.get(MODEL_FACTS_KEYS.enabled, false)) return summary;
        if (!this.llm.canGenerate()) {
            this.logger.debug(`facts: no model to read with (${this.llm.explainGenerator()})`);
            return summary;
        }

        const documents = await this.facts.listPendingDocuments('model', limit);

        for (const document of documents) {
            if (stop?.aborted) break;

            try {
                const claims = await this.modelClaimsFor(document, stop);
                const written = await this.facts.recordExtraction(document, 'model', claims);
                summary.read++;
                summary.written += written;
                if (written === 0) summary.empty++;
            } catch (error) {
                // Includes the gate's own `timeout`, which is not a failure of
                // this pass so much as the station using its model for something
                // that matters more. Either way the document keeps no mark and
                // is picked up next time.
                summary.failed++;
                this.logger.warn(`facts: a model could not read ${document.url} (${errorText(error)})`);
            }
        }

        return summary;
    }

    /**
     * One document, read and then checked.
     *
     * The verification is per claim and sequential rather than batched, because
     * each one is a separate hold on the one model slot and a batch would keep
     * it for the length of all of them. A claim whose check fails, errors, or
     * comes back as anything other than yes is dropped without comment: the
     * caller cannot tell the difference and should not, since every one of them
     * means the same thing about the claim.
     */
    private async modelClaimsFor(document: PendingDocument, stop?: AbortSignal): Promise<FactWrite[]> {
        const model = this.config.get(MODEL_FACTS_KEYS.model, '').trim();
        const subject: ExtractionSubject = {
            kind: SUBJECT_KIND[document.subject.type],
            name: document.name,
            ...(document.artist === undefined ? {} : { artist: document.artist }),
        };

        const started = Date.now();
        const answer = await this.llm.converse(
            { messages: extractPrompt(subject, document.text), ...(model.length === 0 ? {} : { model }), reasoningEffort: 'low' },
            { budgetMs: MODEL_BUDGET_MS, maxWaitMs: MODEL_WAIT_MS, tools: false },
        );

        const found = readClaims(answer.text, document.text);
        const kept: FactWrite[] = [];

        for (const claim of found) {
            if (stop?.aborted) break;
            if (!(await this.supported(claim.claim, claim.quote, model))) continue;

            kept.push({
                subject: document.subject,
                claim: claim.claim,
                category: claim.category,
                source: 'model',
                sourceProvider: document.provider,
                sourceUrl: document.url,
                sourceQuote: claim.quote,
                ...(model.length === 0 ? {} : { model }),
            });
        }

        // The numbers rather than a verdict, for the reason the set generator
        // logs its own: "the model stopped finding anything" and "the verifier
        // started refusing everything" are the two questions worth asking of
        // this later, and neither can be asked of figures nobody gathered.
        this.logger.info('facts: a model read an article', {
            subject: document.subject.type,
            url: document.url,
            claimed: found.length,
            kept: kept.length,
            durationMs: Date.now() - started,
            finish: answer.finishReason,
            ...(answer.usage === undefined ? {} : { tokens: answer.usage.totalTokens ?? answer.usage.outputTokens }),
        });

        return kept;
    }

    /**
     * Whether the quoted text really states the claim, asked of a conversation
     * that has been told nothing else.
     *
     * A separate call rather than a second question in the first one, and that
     * is the whole mechanism: a model asked to produce facts and then to check
     * its own list in the same breath approves its own work. This one has never
     * seen the article, does not know what record it is about, and is asked only
     * whether one short string entails another.
     *
     * A failure answers `false`. The verifier being broken must not become a
     * route by which unverified claims reach the table.
     */
    private async supported(claim: string, quote: string, model: string): Promise<boolean> {
        try {
            const answer = await this.llm.converse(
                { messages: verifyPrompt(claim, quote), ...(model.length === 0 ? {} : { model }), maxOutputTokens: 8, reasoningEffort: 'low' },
                { budgetMs: VERIFY_BUDGET_MS, maxWaitMs: MODEL_WAIT_MS, tools: false },
            );

            return verified(answer.text);
        } catch (error) {
            this.logger.debug(`facts: could not check a claim (${errorText(error)})`);
            return false;
        }
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
