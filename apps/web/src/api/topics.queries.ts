import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TopicImportResult, TopicInput, TopicList, TopicPack } from '@deadair/sdk';

import { saveJsonDownload } from '../components/shared/download';
import { sdk } from './client';
import { useListWrite } from './mutation.kit';
import { queryKeys } from './query.keys';

/**
 * How long the station's vocabulary stays fresh.
 *
 * The personas' reasoning: these move when an operator moves them, every write answers with the
 * whole list and is written straight into the cache, and the only invisible writer is somebody
 * editing the table by hand.
 */
const TOPICS_STALE_TIME = 30_000;

export const topicsOptions = queryOptions({
    queryKey: queryKeys.topics.list(),
    queryFn: () => sdk.topics.listTopics({}),
    staleTime: TOPICS_STALE_TIME,
});

/** Every subject this station has named, across every sort of break. */
export function useTopics() {
    return useQuery(topicsOptions);
}

/**
 * Which sorts of break have subjects, and the form each one's is written with.
 *
 * Cached hard, because this is a fact about what the station can DO rather than about what the
 * operator has said: it changes when a capability arrives, which is a deploy rather than an edit.
 */
export const topicKindsOptions = queryOptions({
    queryKey: queryKeys.topics.kinds(),
    queryFn: () => sdk.topics.listTopicKinds(),
    staleTime: Infinity,
});

export function useTopicKinds() {
    return useQuery(topicKindsOptions);
}

/** Every write, sharing one success path: the answer is the whole list, so nothing refetches. */
function useTopicWrite<TArgs>(mutationFn: (args: TArgs) => Promise<TopicList>) {
    // Deleting a subject takes any band that asked for it with it, so the format clock the schedule
    // page draws is no longer what the server holds. Invalidated rather than written, since this
    // answer says nothing about bands.
    return useListWrite(queryKeys.topics.list(), mutationFn, [queryKeys.director.clock()]);
}

export const useCreateTopic = () => useTopicWrite((body: TopicInput) => sdk.topics.createTopic(body));

export const useUpdateTopic = () => useTopicWrite(({ id, body }: { id: string; body: TopicInput }) => sdk.topics.updateTopic(id, body));

export const useDeleteTopic = () => useTopicWrite((id: string) => sdk.topics.deleteTopic(id));

/** Saves every subject as a file. A download is not state this console holds, so this is no query. */
export async function exportTopics(): Promise<void> {
    saveJsonDownload(await sdk.topics.exportTopics(), 'deadair-topics.json');
}

export function usePreviewTopicImport() {
    return useMutation({ mutationFn: (pack: TopicPack) => sdk.topics.previewTopicImport(pack) });
}

/** An import answers the list as it now stands, beside what it did. */
export function useImportTopics() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (pack: TopicPack) => sdk.topics.importTopics(pack),
        onSuccess: (answer: TopicImportResult) => {
            queryClient.setQueryData(queryKeys.topics.list(), answer.list);
        },
    });
}
