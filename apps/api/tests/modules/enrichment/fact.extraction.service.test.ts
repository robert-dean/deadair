// The pass around the model, where every interesting case is a way of declining. Nothing here
// asserts on real model output: what matters is that a missing model, a busy slot, a refusal and a
// verifier that says no all end the same way — the floor's claims banked, the document unmarked,
// and nothing on air affected.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { FactExtractionService, MODEL_FACTS_KEYS } from '../../../src/modules/enrichment/fact.extraction.service.js';
import type { FactRepository, PendingDocument } from '../../../src/modules/enrichment/fact.repository.js';
import type { LlmService } from '../../../src/modules/llm/llm.service.js';

const ARTICLE = [
    '"Rusty Cage" is a song by the American rock band Soundgarden, released in 1992 as the third single from Badmotorfinger.',
    'The song appeared in the 1994 film Ace Ventura: Pet Detective.',
].join(' ');

const document: PendingDocument = {
    subject: { type: 'track', id: 'track-1' },
    name: 'Rusty Cage',
    artist: 'Soundgarden',
    provider: 'deadair.wikipedia',
    url: 'https://en.wikipedia.org/wiki/Rusty_Cage',
    title: 'Rusty Cage',
    text: ARTICLE,
};

const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/** The claim the fixture article really supports, quoted from it exactly. */
const FOUND = JSON.stringify({
    facts: [{ claim: 'It was used in Ace Ventura.', quote: 'The song appeared in the 1994 film Ace Ventura: Pet Detective.', category: 'placement' }],
});

interface Options {
    /** `unknown` rather than `boolean`, so a case can hand over the STRING a settings row holds. */
    enabled?: unknown;
    canGenerate?: boolean;
    /** Answers in call order: the extraction, then one verification per claim. */
    answers?: (string | Error)[];
    documents?: PendingDocument[];
}

function build(options: Options = {}) {
    const written: unknown[][] = [];
    const facts = {
        listPendingDocuments: vi.fn(async () => options.documents ?? [document]),
        recordExtraction: vi.fn(async (_document: PendingDocument, _source: string, claims: unknown[]) => {
            written.push(claims);
            return claims.length;
        }),
    } as unknown as FactRepository;

    const answers = [...(options.answers ?? [FOUND, 'yes'])];
    // The request is typed loosely but NAMED, so a test can read back what the second call was
    // actually shown — which is the point of the verification being a separate conversation.
    // The OPTIONS are named as well as the request, because the tier this pass takes the model at
    // is not visible in anything it produces: a wrong one reads as a perfectly good extraction and
    // costs a refill somewhere else entirely. See the priority test below.
    const converse = vi.fn(async (request: { messages: { role: string; content: unknown }[] }, options?: { priority?: string }) => {
        void request;
        void options;
        const next = answers.shift();
        if (next instanceof Error) throw next;
        return { text: next ?? '', finishReason: 'stop' };
    });

    const llm = {
        canGenerate: () => options.canGenerate ?? true,
        explainGenerator: () => 'no plugin can produce words',
        converse,
    } as unknown as LlmService;

    const config = {
        get: (key: string, fallback: unknown) => (key === MODEL_FACTS_KEYS.enabled ? (options.enabled ?? true) : fallback),
    } as AppConfig;

    return { service: new FactExtractionService(facts, llm, config, quiet), facts, converse, written };
}

describe('the model pass', () => {
    it('reads an article and keeps what the verifier confirms', async () => {
        const { service, written } = build();

        const summary = await service.extractModel(10);

        expect(summary).toMatchObject({ read: 1, written: 1, empty: 0, failed: 0 });
        expect(written[0]).toEqual([
            expect.objectContaining({
                claim: 'It was used in Ace Ventura.',
                category: 'placement',
                source: 'model',
                sourceProvider: 'deadair.wikipedia',
                sourceUrl: 'https://en.wikipedia.org/wiki/Rusty_Cage',
                sourceQuote: 'The song appeared in the 1994 film Ace Ventura: Pet Detective.',
            }),
        ]);
    });

    it('checks each claim in a conversation that never saw the article', async () => {
        // A model asked to produce facts and check its own list in one breath approves its own work.
        const { service, converse } = build();

        await service.extractModel(10);

        const verification = String(converse.mock.calls[1]?.[0]?.messages?.[1]?.content ?? '');
        expect(converse).toHaveBeenCalledTimes(2);
        expect(verification).toContain('It was used in Ace Ventura.');
        expect(verification).not.toContain('Badmotorfinger');
    });

    it('takes the model as background work, on BOTH calls', async () => {
        // `LlmGate` defaults a caller to `air`, so saying nothing here is claiming a deadline this
        // pass does not have — and `air` does not merely outrank `background`, it PREEMPTS it. Live:
        // a briefed refill was handed 24 matching records and taken off the model 171ms later by
        // this pass, its retry lost the slot after 5ms, and the hour went to the floor.
        //
        // Both calls are asserted because the verification is a separate conversation per claim, so
        // a tier set on the extraction alone would leave the more frequent caller preempting.
        const { service, converse } = build();

        await service.extractModel(10);

        expect(converse).toHaveBeenCalledTimes(2);
        for (const [, options] of converse.mock.calls) expect(options?.priority).toBe('background');
    });

    it('drops a claim the verifier will not confirm, and records the document as read', async () => {
        const { service, written } = build({ answers: [FOUND, 'no'] });

        const summary = await service.extractModel(10);

        expect(written[0]).toEqual([]);
        expect(summary).toMatchObject({ read: 1, written: 0, empty: 1 });
    });

    it('drops a claim when the verifier itself fails, rather than letting it through unchecked', async () => {
        // A broken verifier must not become the route by which unverified claims reach the table.
        const { service, written } = build({ answers: [FOUND, new Error('the model host is down')] });

        await service.extractModel(10);

        expect(written[0]).toEqual([]);
    });

    it('does nothing at all when the operator has not turned it on', async () => {
        const { service, facts, converse } = build({ enabled: false });

        expect(await service.extractModel(10)).toMatchObject({ read: 0, written: 0, failed: 0 });
        expect(facts.listPendingDocuments).not.toHaveBeenCalled();
        expect(converse).not.toHaveBeenCalled();
    });

    it('does nothing when the setting holds the STRING a settings row stores', async () => {
        // The case above hands over a real `false` and passes either way. `deadair.settings` stores
        // text and `'false'` is truthy, so this is the reading that was running the model pass on a
        // station whose operator had switched it off.
        const { service, facts, converse } = build({ enabled: 'false' });

        expect(await service.extractModel(10)).toMatchObject({ read: 0, written: 0, failed: 0 });
        expect(facts.listPendingDocuments).not.toHaveBeenCalled();
        expect(converse).not.toHaveBeenCalled();
    });

    it('does nothing when the station has no model, which is an ordinary state', async () => {
        const { service, converse } = build({ canGenerate: false });

        expect(await service.extractModel(10)).toMatchObject({ read: 0, failed: 0 });
        expect(converse).not.toHaveBeenCalled();
    });

    it('steps over a document the model could not be reached for, leaving it unmarked', async () => {
        // Includes the gate giving up: a break wanted the slot, which is the priority working.
        const { service, facts } = build({ answers: [new Error('waited 5000ms for the model and it is still busy')] });

        expect(await service.extractModel(10)).toMatchObject({ read: 0, failed: 1 });
        expect(facts.recordExtraction).not.toHaveBeenCalled();
    });

    it('records a document that produced nothing, so it is not read forever', async () => {
        const { service, written } = build({ answers: ['I cannot help with that.'] });

        const summary = await service.extractModel(10);

        expect(written[0]).toEqual([]);
        expect(summary).toMatchObject({ read: 1, written: 0, empty: 1, failed: 0 });
    });

    it('stops where it is told to, mid-walk', async () => {
        const stop = AbortSignal.abort();
        const { service, facts } = build();

        expect(await service.extractModel(10, stop)).toMatchObject({ read: 0 });
        expect(facts.recordExtraction).not.toHaveBeenCalled();
    });
});
