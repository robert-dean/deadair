// The two ends of a topics file on the service: a preview writes nothing and says what the import does,
// and a version this station cannot read is refused before anything is written.

import { describe, expect, it, vi } from 'vitest';

import type { TopicKindRegistry } from '../../../src/modules/topics/topic.kind.registry.js';
import type { TopicRepository } from '../../../src/modules/topics/topic.repository.js';
import type { Topic } from '../../../src/modules/topics/topic.js';
import { TopicsService } from '../../../src/modules/topics/topics.service.js';
import type { TopicPack } from '../../../src/modules/topics/types/topics.types.js';

const sport: Topic = { id: 'a', kind: 'news', key: 'sport', label: 'Sport', config: {}, position: 0 };

const file: TopicPack = {
    format: 'deadair.topics',
    version: 1,
    name: 'A file',
    topics: [
        { kind: 'news', key: 'sport', label: 'Sport' },
        { kind: 'news', key: 'tech', label: 'Technology' },
        { kind: 'traffic', key: 'a', label: 'The ring road' },
    ],
};

function service() {
    const create = vi.fn(async () => sport);
    const topics = { list: vi.fn(async () => [sport]), create } as unknown as TopicRepository;
    const registry = { all: () => [{ kind: 'news' }] } as unknown as TopicKindRegistry;
    return { service: new TopicsService(topics, registry), create };
}

describe('TopicsService import', () => {
    it('previews without writing', async () => {
        const { service: topics, create } = service();
        const plan = await topics.previewImport(file);
        expect(plan).toMatchObject({ name: 'A file', adding: ['Technology', 'The ring road'], skipped: ['Sport'], dropped: [] });
        expect(plan.notices.map(notice => notice.kind)).toEqual(['unknown-kind']);
        expect(create).not.toHaveBeenCalled();
    });

    it('writes exactly what the preview named', async () => {
        const { service: topics, create } = service();
        const plan = await topics.previewImport(file);
        const answer = await topics.importPack(file);
        expect(answer.plan).toEqual(plan);
        expect(create.mock.calls.map(([draft]: unknown[]) => (draft as Topic).label)).toEqual(plan.adding);
    });

    it('refuses a newer version before writing anything', async () => {
        const { service: topics, create } = service();
        await expect(topics.importPack({ ...file, version: 2 })).rejects.toThrow();
        expect(create).not.toHaveBeenCalled();
    });
});
