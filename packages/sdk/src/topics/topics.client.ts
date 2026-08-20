import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString } from '../sdk-options.js';
import type { Topic, TopicInput, TopicKindList, TopicList, TopicQuery } from './types/topics.types.js';

export class TopicsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List topics
     * @description Every subject this station has named, for one sort of break or for all of them
     */
    async listTopics(query?: TopicQuery): Promise<TopicList> {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/topics${qs}`, {
            method: 'GET',
        });
        return await parseJson<TopicList>(result);
    }

    /**
     * @name Create topic
     * @description Names a new subject. Nothing uses it until something points at it
     */
    async createTopic(body: TopicInput): Promise<TopicList> {
        const result = await this.fetch(`/topics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<TopicList>(result);
    }

    /**
     * @name List topic kinds
     * @description Which sorts of break have subjects, and the form each one's settings are edited with
     */
    async listTopicKinds(): Promise<TopicKindList> {
        const result = await this.fetch(`/topics/kinds`, { method: 'GET' });
        return await parseJson<TopicKindList>(result);
    }

    /**
     * @name Update topic
     * @description Rewrites one subject. A break already written keeps the words it was given
     */
    async updateTopic(id: string, body: TopicInput): Promise<TopicList> {
        const result = await this.fetch(`/topics/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<TopicList>(result);
    }

    /**
     * @name Delete topic
     * @description Removes a subject, and any band on the format clock that asked for it
     */
    async deleteTopic(id: string): Promise<TopicList> {
        const result = await this.fetch(`/topics/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return await parseJson<TopicList>(result);
    }
}
