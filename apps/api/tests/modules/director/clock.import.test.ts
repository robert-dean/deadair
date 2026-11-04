// The two ends of a clock file on the service. What is pinned: a preview writes nothing, the import does what
// it said, every band lands switched off and pointed at a real subject, and the bands already here are untouched.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import type { BreakWriterRegistry } from '../../../src/modules/director/break.writer.registry.js';
import type { ClockBandRepository } from '../../../src/modules/director/clock.band.repository.js';
import type { ClockBandDraft, ClockBandRecord } from '../../../src/modules/director/clock.bands.js';
import { ClockService } from '../../../src/modules/director/clock.service.js';
import type { ClockPack } from '../../../src/modules/director/types/clock.types.js';
import type { NarrationsService } from '../../../src/modules/narrations/narrations.service.js';
import type { PodcastsService } from '../../../src/modules/podcasts/podcasts.service.js';
import type { SegmentRepository } from '../../../src/modules/render/segment.repository.js';
import type { SpeechService } from '../../../src/modules/render/speech.service.js';
import type { TopicRepository } from '../../../src/modules/topics/topic.repository.js';
import type { Topic, TopicDraft } from '../../../src/modules/topics/topic.js';
import { settingsConfig } from '../../utils/settings.config.js';

const held: ClockBandRecord = { id: 'b1', at: 'clock', minute: 0, kind: 'news', position: 5, enabled: true };

const file: ClockPack = {
    format: 'deadair.clock',
    version: 1,
    name: 'A file',
    bands: [
        { kind: 'news', at: 'clock', minute: 0 },
        { kind: 'news', at: 'clock', minute: 30, topic: { key: 'arts', label: 'Arts', config: { a: 1 } } },
        { kind: 'sponsor', at: 'interval', everyMs: 600_000 },
    ],
};

function service() {
    const bandRows: ClockBandRecord[] = [held];
    const topicRows: Topic[] = [];
    const createBand = vi.fn(async (draft: ClockBandDraft) => {
        bandRows.push({ ...draft, id: `b${bandRows.length + 1}`, position: draft.position ?? 0, enabled: draft.enabled ?? true } as ClockBandRecord);
        return undefined;
    });
    const createTopic = vi.fn(async (draft: TopicDraft) => {
        const topic = { ...draft, id: `t${topicRows.length + 1}` };
        topicRows.push(topic);
        return topic;
    });

    const clock = new ClockService(
        { list: async () => bandRows, create: createBand } as unknown as ClockBandRepository,
        { list: async () => topicRows, create: createTopic } as unknown as TopicRepository,
        { kinds: () => ['news'] } as unknown as BreakWriterRegistry,
        { speaker: () => ({}) } as unknown as SpeechService,
        { readyKinds: async () => [] } as unknown as SegmentRepository,
        settingsConfig({}).config as AppConfig,
        { hasPodcasts: () => false } as unknown as PodcastsService,
        { hasNarrations: () => false } as unknown as NarrationsService,
    );
    return { clock, createBand, createTopic };
}

describe('ClockService import', () => {
    it('previews without writing, and says what comes along and what cannot be made', async () => {
        const { clock, createBand, createTopic } = service();
        const plan = await clock.previewImport(file);
        expect(plan.adding).toEqual(['news, Arts: every hour at :30', 'sponsor: every 10 minutes']);
        expect(plan.skipped).toEqual(['news: every hour at :00']);
        expect(plan.notices.map(notice => notice.kind)).toEqual(['new-subject', 'cannot-produce']);
        expect(plan.notices[1]?.message).toContain('sponsor');
        expect(createBand).not.toHaveBeenCalled();
        expect(createTopic).not.toHaveBeenCalled();
    });

    it('writes what the preview named, switched off, after the bands here', async () => {
        const { clock, createBand } = service();
        const plan = await clock.previewImport(file);
        const answer = await clock.importPack(file);

        expect(answer.plan.adding).toEqual(plan.adding);
        expect(createBand.mock.calls.map(([draft]) => [draft.kind, draft.position, draft.enabled])).toEqual([
            ['news', 6, false],
            ['sponsor', 7, false],
        ]);
        expect(answer.list.bands.find(band => band.id === 'b1')).toMatchObject({ position: 5, enabled: true });
    });

    it('points a band at the subject it created', async () => {
        const { clock, createBand, createTopic } = service();
        await clock.importPack(file);
        expect(createTopic).toHaveBeenCalledOnce();
        expect(createBand.mock.calls[0]?.[0].topic).toEqual({ id: 't1', key: 'arts', label: 'Arts' });
        expect(createBand.mock.calls[1]?.[0].topic).toBeUndefined();
    });

    it('refuses a newer version before writing anything', async () => {
        const { clock, createBand, createTopic } = service();
        await expect(clock.importPack({ ...file, version: 2 })).rejects.toThrow();
        expect(createBand).not.toHaveBeenCalled();
        expect(createTopic).not.toHaveBeenCalled();
    });

    it('exports what a station can import again and find nothing new', async () => {
        const { clock } = service();
        await clock.importPack(file);
        const plan = await clock.previewImport(await clock.exportPack());
        expect(plan.adding).toEqual([]);
        expect(plan.skipped).toHaveLength(3);
    });
});
