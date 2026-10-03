// The mood walk: a judgement per record at the lowest priority, the web search as the only tool and
// only where the station can search, and a pass that stops rather than marks records failed when the
// model is busy.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import {
    LyricMoodsService,
    MOODS_FAILURE_MAX_RETRY_MS,
    MOODS_FAILURE_RETRY_MS,
    MOODS_MAX_SEARCHES,
    MOODS_PRIORITY,
} from '../../../src/modules/lyrics/lyric.moods.service.js';
import { MOODS_VERSION } from '../../../src/modules/lyrics/lyric.moods.js';
import type { MoodCandidate } from '../../../src/modules/lyrics/lyric.labels.repository.js';
import { LYRIC_MOODS_KEYS } from '../../../src/modules/lyrics/lyrics.keys.js';
import { settingsConfig } from '../../utils/settings.config.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as unknown as Logger;

const candidate = (trackId = 't1', lyric: string | undefined = 'Give me a reason to love you'): MoodCandidate => ({
    trackId,
    title: 'Glory Box',
    artist: 'Portishead',
    instrumental: false,
    ...(lyric === undefined ? {} : { lyric }),
});

function build(options: { answers?: unknown[]; searchable?: boolean; candidates?: MoodCandidate[]; settings?: Record<string, string> } = {}) {
    const answers = [...(options.answers ?? [{ text: '{"moods":{"sadness":3,"love":1}}', finishReason: 'stop' }])];
    const labels = {
        listTracksNeedingMoods: vi.fn(async () => options.candidates ?? [candidate()]),
        saveMoods: vi.fn(async () => {}),
        recordMoodFailure: vi.fn(async () => {}),
    };
    const llm = {
        converse: vi.fn(async () => {
            const next = answers.shift();
            if (next instanceof Error) throw next;
            return next ?? { text: '{"unknown":true}', finishReason: 'stop' };
        }),
    };
    const search = { hasSearch: vi.fn(() => options.searchable ?? false) };
    const service = new LyricMoodsService(labels as never, llm as never, search as never, settingsConfig(options.settings).config, logger());
    return { service, labels, llm };
}

describe('LyricMoodsService', () => {
    it('stores the distribution, under the current instructions', async () => {
        const { service, labels } = build();

        expect(await service.labelPending(10)).toEqual({ judged: 1, unplaced: 0, failed: 0, yielded: false });
        expect(labels.saveMoods).toHaveBeenCalledWith('t1', expect.objectContaining({ sadness: 0.75, love: 0.25 }), MOODS_VERSION);
    });

    it('records "could not tell" as a judgement with no moods, so the record is not asked again', async () => {
        const { service, labels } = build({ answers: [{ text: '{"unknown":true}', finishReason: 'stop' }] });

        expect((await service.labelPending(10)).unplaced).toBe(1);
        expect(labels.saveMoods).toHaveBeenCalledWith('t1', undefined, MOODS_VERSION);
    });

    it('backs off a record whose answer was not a distribution', async () => {
        const { service, labels } = build({ answers: [{ text: 'It is quite sad, I think.', finishReason: 'stop' }] });

        expect((await service.labelPending(10)).failed).toBe(1);
        expect(labels.recordMoodFailure).toHaveBeenCalledWith('t1', expect.any(String), MOODS_FAILURE_RETRY_MS, MOODS_FAILURE_MAX_RETRY_MS);
    });

    it('offers only the web search, and only where the station can search', async () => {
        const searching = build({ searchable: true });
        await searching.service.labelPending(10);
        expect(searching.llm.converse).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ onlyTools: ['search_web'], maxToolSteps: MOODS_MAX_SEARCHES, priority: MOODS_PRIORITY }),
        );
        expect(searching.service).toBeDefined();

        const offline = build({ searchable: false });
        await offline.service.labelPending(10);
        expect(offline.llm.converse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tools: false, priority: MOODS_PRIORITY }));
    });

    it('asks the repository for records with no lyric only when it can search', async () => {
        const { service, labels } = build({ searchable: true });
        await service.labelPending(7, undefined, ['next']);
        expect(labels.listTracksNeedingMoods).toHaveBeenCalledWith(MOODS_VERSION, 7, true, ['next']);
    });

    it('stops the pass, marking nothing, when the model is busy', async () => {
        const { service, labels } = build({ answers: [new Error('the model is busy')], candidates: [candidate('t1'), candidate('t2')] });

        expect((await service.labelPending(10)).yielded).toBe(true);
        expect(labels.recordMoodFailure).not.toHaveBeenCalled();
        expect(labels.saveMoods).not.toHaveBeenCalled();
    });

    it('stops when something with a deadline takes the model', async () => {
        const { service, labels } = build({ answers: [{ text: '', finishReason: 'preempted' }], candidates: [candidate('t1'), candidate('t2')] });

        expect((await service.labelPending(10)).yielded).toBe(true);
        expect(labels.saveMoods).not.toHaveBeenCalled();
    });

    it('asks the model the operator chose', async () => {
        const { service, llm } = build({ settings: { [LYRIC_MOODS_KEYS.model]: 'local:big-model' } });
        await service.labelPending(10);
        expect(llm.converse).toHaveBeenCalledWith(expect.objectContaining({ model: 'local:big-model' }), expect.anything());
    });
});
