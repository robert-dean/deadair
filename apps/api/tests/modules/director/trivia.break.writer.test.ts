// The floor under a trivia break: no network, no model, and no way to fail that costs the station a
// break it could have had.
//
// Three things carry the weight. The DECLINE, because a break that announced trivia and gave none is
// worse than the slot being passed over. The claim read out WORD FOR WORD, which is the whole of why
// a deterministic writer may handle a factual claim at all. And the SPEND, which happens here and
// only for the one claim that reached a script.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { reportOf, TRIVIA_BREAK_KEYS, TRIVIA_TEMPLATES, TriviaBreakWriter } from '../../../src/modules/director/trivia.break.writer.js';
import { TRIVIA_KIND } from '../../../src/modules/director/trivia.kind.js';
import type { TriviaFact } from '../../../src/modules/director/trivia.source.js';
import { unknownPlaceholders } from '../../../src/modules/director/break.templates.js';
import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import type { FactRepository } from '../../../src/modules/enrichment/fact.repository.js';

const FACT: TriviaFact = { factId: 'fact-1', claim: 'Dummy was recorded in Bath over ten months', about: 'Dummy, by Portishead' };

const build = (settings: Record<string, string> = {}, markUsed = vi.fn(async (_ids: readonly string[]) => {})) => {
    const config = { get: (key: string, fallback?: unknown) => settings[key] ?? fallback } as unknown as AppConfig;
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const facts = { markUsed } as unknown as FactRepository;
    return { writer: new TriviaBreakWriter(config, facts, logger), logger, markUsed };
};

const request = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({
    kind: TRIVIA_KIND,
    trivia: [FACT, { factId: 'fact-2', claim: 'Massive Attack formed in Bristol in 1988.', about: 'Massive Attack' }],
    ...overrides,
});

describe('the shipped phrasings', () => {
    it('name nothing the station cannot fill', () => {
        for (const template of TRIVIA_TEMPLATES) expect(unknownPlaceholders(template)).toEqual([]);
    });

    it('every one carries the claim outside its optional parts, after a full stop', () => {
        for (const template of TRIVIA_TEMPLATES) {
            const required = template.replace(/\[\[[^\]]*\]\]/g, '');
            expect(required).toContain('{{trivia.report}}');

            const at = template.indexOf('{{trivia.report}}');
            expect(template.slice(0, at).trimEnd()).toMatch(/[.?]$/);
        }
    });
});

describe('what it says', () => {
    it('reads the first claim exactly as stored, adding only a full stop', async () => {
        const { writer } = build();

        const written = await writer.write(request());

        expect(written?.script).toContain('Dummy was recorded in Bath over ten months.');
        expect(written?.script).not.toContain('Massive Attack');
        expect(written?.label).toBe('Trivia: Dummy, by Portishead');
        expect(written?.listenerLabel).toBe('Trivia');
    });

    it('leaves a claim that already ends a sentence alone', () => {
        expect(reportOf({ ...FACT, claim: 'It went to number one.' })).toBe('It went to number one.');
        expect(reportOf({ ...FACT, claim: '  It was called "Glory Box"  ' })).toBe('It was called "Glory Box"');
    });

    it('uses the operator’s phrasings when there are some', async () => {
        const { writer } = build({ [TRIVIA_BREAK_KEYS.templates]: 'Trivia time about {{trivia.about}}. {{trivia.report}}' });

        expect((await writer.write(request()))?.script).toBe('Trivia time about Dummy, by Portishead. Dummy was recorded in Bath over ten months.');
    });

    it('claims no window when the words said nothing about the time', async () => {
        const { writer } = build({ [TRIVIA_BREAK_KEYS.templates]: 'Did you know? {{trivia.report}}' });

        expect((await writer.write(request()))?.claimsTime).toBeUndefined();
    });
});

describe('when it says nothing', () => {
    it('declines with no claims, rather than announcing trivia it has not got', async () => {
        const { writer, markUsed } = build();

        expect(await writer.write(request({ trivia: undefined }))).toBeUndefined();
        expect(await writer.write(request({ trivia: [] }))).toBeUndefined();
        expect(markUsed).not.toHaveBeenCalled();
    });

    it('declines when no phrasing fits, and spends nothing', async () => {
        const { writer, markUsed } = build({ [TRIVIA_BREAK_KEYS.templates]: '{{trivia.report}} Here is {{next.title}}.' });

        expect(await writer.write(request())).toBeUndefined();
        expect(markUsed).not.toHaveBeenCalled();
    });
});

describe('what it spends', () => {
    it('rests the one claim it read out and none of the others', async () => {
        const { writer, markUsed } = build();

        await writer.write(request());

        expect(markUsed).toHaveBeenCalledWith(['fact-1']);
    });

    it('still writes the break when the stamp fails', async () => {
        const { writer, logger } = build(
            {},
            vi.fn(async () => {
                throw new Error('the pool is gone');
            }),
        );

        expect(await writer.write(request())).toBeDefined();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the pool is gone'));
    });
});
