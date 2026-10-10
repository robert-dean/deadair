// The subject walk: what passes the lyric check is stored, what quotes the lyric is refused and retried.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { LyricSubjectsService } from '../../../src/modules/lyrics/lyric.subjects.service.js';
import { SUBJECT_VERSION } from '../../../src/modules/lyrics/lyric.subject.js';
import { settingsConfig } from '../../utils/settings.config.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as unknown as Logger;

const build = (text: string, withLyric = true, finishReason = 'stop') => {
    const labels = {
        listTracksNeedingSubjects: vi.fn(async () => [
            {
                trackId: 't1',
                title: 'Glory Box',
                artist: 'Portishead',
                instrumental: false,
                ...(withLyric ? { lyric: 'Playing with this bow and arrow' } : {}),
            },
        ]),
        saveSubject: vi.fn(async () => {}),
        recordSubjectFailure: vi.fn(async () => {}),
    };
    const llm = { converse: vi.fn(async () => ({ text, finishReason })) };
    const service = new LyricSubjectsService(labels as never, llm as never, { hasSearch: () => true } as never, settingsConfig().config, logger());
    return { service, labels, llm };
};

describe('LyricSubjectsService', () => {
    it('stores a subject that passes the lyric check, searching only the web', async () => {
        const { service, labels, llm } = build('{"about":"Being tired of games in love."}');

        expect((await service.writePending(5)).written).toBe(1);
        expect(labels.saveSubject).toHaveBeenCalledWith('t1', 'Being tired of games in love.', SUBJECT_VERSION, true);
        expect(llm.converse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ onlyTools: ['search_web'] }));
    });

    it('says a subject written without the lyric was, so the walk writes it again once the lyric arrives', async () => {
        const { service, labels } = build('{"about":"Being tired of games in love."}', false);

        await service.writePending(5);
        expect(labels.saveSubject).toHaveBeenCalledWith('t1', 'Being tired of games in love.', SUBJECT_VERSION, false);
    });

    it('refuses and retries one that quotes the lyric, never storing it', async () => {
        const { service, labels } = build('{"about":"Playing with this bow and arrow, she gives up."}');

        expect((await service.writePending(5)).refused).toBe(1);
        expect(labels.saveSubject).not.toHaveBeenCalled();
        expect(labels.recordSubjectFailure).toHaveBeenCalledWith('t1', 'quoted-lyric', expect.any(Number), expect.any(Number));
    });

    it('retries one that ran out of time later rather than stopping the pass', async () => {
        // A spent budget is a fact about this record, where a preemption is a fact about the
        // station's schedule; only the second is a reason to stop.
        const { service, labels } = build('', true, 'budget');

        const summary = await service.writePending(5);

        expect(summary).toEqual(expect.objectContaining({ refused: 1, yielded: false }));
        expect(labels.saveSubject).not.toHaveBeenCalled();
        expect(labels.recordSubjectFailure).toHaveBeenCalledWith('t1', 'the model ran out of time', expect.any(Number), expect.any(Number));
    });

    it('stops the pass when a break takes the model, marking nothing', async () => {
        const { service, labels } = build('', true, 'preempted');

        expect((await service.writePending(5)).yielded).toBe(true);
        expect(labels.recordSubjectFailure).not.toHaveBeenCalled();
    });
});
