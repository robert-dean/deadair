import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { buildMixDraft, mixDraftPrompt, readMixDraft, type DraftRule } from '../../../src/modules/director/mix.draft.js';
import { MixDraftService } from '../../../src/modules/director/mix.draft.service.js';
import { MIX_FLOW_KEYS } from '../../../src/modules/director/mix.flow.keys.js';
import { mixFlowProblems } from '../../../src/modules/schedule/mix.flow.validate.js';
import type { MixFlow, MixNode } from '../../../src/modules/schedule/types/mix.types.js';
import { settingsConfig } from '../../utils/settings.config.js';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

/** The Church show's brief as a model reads it. */
const CHURCH = JSON.stringify({
    rules: [
        { kind: 'block', bands: ['Burzum'], quote: 'never Burzum', note: 'Burzum never plays.' },
        {
            kind: 'limit',
            genres: ['Black Metal'],
            percent: 10,
            per: 'hour',
            later: { fromHour: 22, percent: 30 },
            quote: 'black metal only now and then',
            note: 'A tenth of each hour, a third after ten.',
        },
        {
            kind: 'limit',
            genres: ['pop'],
            question: 'Is this a famous, sinful pop hit?',
            count: 1,
            per: 'show',
            others: 'hold',
            quote: 'a rare sinful pop hit',
            note: 'One a show.',
        },
        { kind: 'require', genres: ['pop', 'gospel'], mode: 'any', afterPercent: 40, quote: 'or gospel record', note: 'One pop or gospel record.' },
        { kind: 'noRepeat', genres: ['black metal'], quote: 'never two black metal records together', note: '' },
    ],
    taste: [{ quote: 'candlelit and doom-laden', note: 'Left to the picks.' }],
    questions: [{ quote: 'or gospel record', question: 'Should the promised record be pop or gospel?', options: ['Either', 'Gospel only'] }],
});

const byKind = (flow: MixFlow, kind: MixNode['kind']) => flow.nodes.filter(node => node.kind === kind);
const into = (flow: MixFlow, id: string) => flow.links.filter(link => link.to === id);
const outOf = (flow: MixFlow, id: string, out = 0) => flow.links.find(link => link.from === id && link.out === out)?.to;

describe('readMixDraft', () => {
    it('reads each rule, the taste and the questions, lower-casing genres', () => {
        const read = readMixDraft(`Here you go:\n${CHURCH}`)!;
        expect(read.rules.map(rule => rule.kind)).toEqual(['block', 'limit', 'limit', 'require', 'noRepeat']);
        expect(read.rules[1]).toMatchObject({
            kind: 'limit',
            match: { genres: ['black metal'] },
            percent: 10,
            per: 'hour',
            later: { fromHour: 22, percent: 30 },
        });
        expect(read.rules[2]).toMatchObject({
            kind: 'limit',
            count: 1,
            per: 'show',
            others: 'hold',
            match: { question: 'Is this a famous, sinful pop hit?' },
        });
        expect(read.readings).toContainEqual({ quote: 'candlelit and doom-laden', note: 'Left to the picks.' });
        expect(read.readings).toContainEqual(
            expect.objectContaining({ question: 'Should the promised record be pop or gospel?', options: ['Either', 'Gospel only'] }),
        );
    });

    it('turns a rule it cannot use into a reading that says why, and clamps amounts', () => {
        const read = readMixDraft(
            JSON.stringify({
                rules: [
                    { kind: 'block', bands: [], quote: 'no bad bands' },
                    { kind: 'limit', genres: ['jazz'], quote: 'some jazz' },
                    { kind: 'teleport', quote: 'beam it' },
                    { kind: 'limit', genres: ['jazz'], percent: 250, quote: 'all the jazz' },
                ],
            }),
        )!;
        expect(read.rules).toEqual([expect.objectContaining({ kind: 'limit', percent: 100 })]);
        expect(read.readings.map(reading => reading.quote)).toEqual(['no bad bands', 'some jazz', 'beam it']);
    });

    it('answers nothing for an answer with no rules in it', () => {
        expect(readMixDraft('I would keep black metal rare.')).toBeUndefined();
        expect(readMixDraft('{"rules": "none"}')).toBeUndefined();
        expect(readMixDraft('{"rules": []}')).toBeUndefined();
    });
});

describe('buildMixDraft', () => {
    it("lays the Church show's rules out as a flow that passes the save's own check", () => {
        const { flow, readings } = buildMixDraft(readMixDraft(CHURCH)!);
        expect(mixFlowProblems(flow)).toEqual([]);

        const [block] = byKind(flow, 'block');
        expect(block).toMatchObject({ bands: ['Burzum'], fromBrief: 'never Burzum' });
        expect(outOf(flow, 'picks')).toBe(block!.id);

        // Black metal: split on genre, its branch through a share fed by the clock, then no two in a row.
        const genreSplits = byKind(flow, 'split').filter(node => node.splitBy === 'genre');
        expect(genreSplits.map(node => node.branches)).toEqual([[{ values: ['black metal'] }], [{ values: ['pop'] }]]);
        const share = byKind(flow, 'limitShare')[0]!;
        expect(share).toMatchObject({ percent: 10, per: 'hour' });
        expect(outOf(flow, genreSplits[0]!.id, 0)).toBe(share.id);
        const clock = byKind(flow, 'timeSwitch')[0]!;
        expect(clock).toMatchObject({ fromHour: 22, thenValue: 30, elseValue: 10 });
        expect(flow.links).toContainEqual({ from: clock.id, out: 0, to: share.id, in: 1 });
        expect(byKind(flow, 'noRepeat').map(node => node.id)).toEqual([outOf(flow, share.id)]);

        // Pop: the judge asks, a yes meets one-a-show, and a no meets none at all.
        const judge = byKind(flow, 'split').find(node => node.splitBy === 'judged')!;
        expect(judge.question).toBe('Is this a famous, sinful pop hit?');
        expect(outOf(flow, genreSplits[1]!.id, 0)).toBe(judge.id);
        const counts = byKind(flow, 'limitCount');
        expect(counts.find(node => node.id === outOf(flow, judge.id, 0))).toMatchObject({ count: 1, per: 'show' });
        expect(counts.find(node => node.id === outOf(flow, judge.id, 1))).toMatchObject({ count: 0 });

        // The promise skips the limits, entering at the Merge.
        const [require] = byKind(flow, 'require');
        expect(require).toMatchObject({ requireGenres: ['pop', 'gospel'], requireMode: 'any', afterPercent: 40 });
        expect(outOf(flow, require!.id)).toBe(byKind(flow, 'merge')[0]!.id);

        expect(readings.find(reading => reading.quote === 'black metal only now and then')?.nodeIds).toEqual(
            expect.arrayContaining([genreSplits[0]!.id, share.id, clock.id]),
        );
        expect(readings.find(reading => reading.quote === 'never two black metal records together')?.nodeIds).toEqual(
            byKind(flow, 'noRepeat').map(node => node.id),
        );
    });

    it('wires Picks straight to On air when the brief has only taste', () => {
        const { flow, readings } = buildMixDraft({ rules: [], readings: [{ quote: 'moody', note: 'Left to the picks.' }] });
        expect(flow.links).toEqual([{ from: 'picks', out: 0, to: 'air', in: 0 }]);
        expect(readings).toEqual([{ quote: 'moody', note: 'Left to the picks.' }]);
    });

    it('lets the "no" of a genre-and-question limit play when the model says to', () => {
        const { flow } = buildMixDraft({
            rules: [{ kind: 'limit', match: { genres: ['pop'], question: 'A hit?' }, count: 2, per: 'show', others: 'pass', quote: '', note: '' }],
            readings: [],
        });
        const judge = byKind(flow, 'split').find(node => node.splitBy === 'judged')!;
        expect(outOf(flow, judge.id, 1)).toBe('merge-1');
        expect(byKind(flow, 'limitCount')).toHaveLength(1);
        expect(mixFlowProblems(flow)).toEqual([]);
    });

    it('passes the check for every mix of rule kinds it can be handed', () => {
        const kinds: DraftRule[] = [
            { kind: 'block', bands: ['Burzum'], quote: 'a', note: '' },
            { kind: 'limit', match: { genres: ['metal'] }, percent: 20, per: 'hour', others: 'pass', quote: 'b', note: '' },
            { kind: 'limit', match: { genres: [], question: 'A ballad?' }, count: 2, per: 'show', others: 'pass', quote: 'c', note: '' },
            { kind: 'limit', match: { genres: ['pop'], question: 'A hit?' }, count: 1, per: 'show', others: 'hold', quote: 'd', note: '' },
            {
                kind: 'limit',
                match: { genres: ['jazz'] },
                percent: 5,
                per: 'show',
                later: { fromHour: 1, percent: 15 },
                others: 'pass',
                quote: 'e',
                note: '',
            },
            { kind: 'require', genres: ['gospel'], songs: [], mode: 'each', afterPercent: 10, quote: 'f', note: '' },
            {
                kind: 'require',
                genres: [],
                songs: [{ title: 'Thriller', artist: 'Michael Jackson' }],
                mode: 'any',
                afterPercent: 0,
                quote: 'g',
                note: '',
            },
            { kind: 'noRepeat', genres: ['metal'], quote: 'h', note: '' },
            { kind: 'noRepeat', genres: ['folk'], quote: 'i', note: '' },
        ];
        for (let mask = 1; mask < 1 << kinds.length; mask++) {
            const rules = kinds.filter((_, index) => mask & (1 << index));
            const { flow } = buildMixDraft({ rules, readings: [] });
            expect({ mask, problems: mixFlowProblems(flow) }).toEqual({ mask, problems: [] });
        }
    });
});

describe('mixDraftPrompt', () => {
    it("tells the model the brief, the library's genres and what the operator answered", () => {
        const [system, user] = mixDraftPrompt(
            'Black metal only now and then.',
            [{ genre: 'black metal', bands: 41 }],
            [{ question: 'Pop or gospel?', answer: 'Gospel only' }],
        );
        expect(system!.content).toContain('"kind": "limit"');
        expect(user!.content).toContain('Black metal only now and then.');
        expect(user!.content).toContain('black metal (41)');
        expect(user!.content).toContain('- Pop or gospel? Gospel only');
    });
});

describe('MixDraftService', () => {
    function service(answers: unknown[], settings: Record<string, string> = {}) {
        const queue = [...answers];
        const llm = {
            converse: vi.fn(async () => {
                const next = queue.shift();
                if (next instanceof Error) throw next;
                return next;
            }),
        };
        const candidates = { commonMainGenres: vi.fn(async () => [{ genre: 'black metal', bands: 41 }]) };
        return { drafts: new MixDraftService(llm as never, candidates as never, settingsConfig(settings).config, logger()), llm };
    }

    it('drafts a flow at preview priority with the draft models, and says which model answered', async () => {
        const { drafts, llm } = service([{ text: CHURCH, finishReason: 'stop', model: 'ollama:qwen3' }], {
            [MIX_FLOW_KEYS.draftModel]: 'ollama:qwen3',
        });
        const draft = await drafts.draft({ brief: 'The Church show.' });
        expect(mixFlowProblems(draft.flow)).toEqual([]);
        expect(draft.model).toBe('ollama:qwen3');
        expect(draft.readings.length).toBeGreaterThan(0);
        expect(llm.converse).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'ollama:qwen3' }),
            expect.objectContaining({ models: ['ollama:qwen3'], priority: 'preview', tools: false }),
        );
    });

    it('asks once more when the answer cannot be read, then refuses', async () => {
        const again = service([
            { text: 'Sure! Keep black metal rare.', finishReason: 'stop', model: 'm' },
            { text: CHURCH, finishReason: 'stop', model: 'm' },
        ]);
        expect((await again.drafts.draft({ brief: 'x' })).flow.nodes.length).toBeGreaterThan(2);
        expect(again.llm.converse).toHaveBeenCalledTimes(2);

        const twice = service([
            { text: 'no', finishReason: 'stop', model: 'm' },
            { text: '{"rules": [', finishReason: 'budget', model: 'm' },
        ]);
        await expect(twice.drafts.draft({ brief: 'x' })).rejects.toMatchObject({ statusCode: 502 });
    });

    it('answers 503 when the model is busy on air or not there', async () => {
        await expect(service([{ text: '', finishReason: 'preempted', model: 'm' }]).drafts.draft({ brief: 'x' })).rejects.toMatchObject({
            statusCode: 503,
        });
        await expect(service([new Error('no llm plugin')]).drafts.draft({ brief: 'x' })).rejects.toMatchObject({ statusCode: 503 });
    });
});
