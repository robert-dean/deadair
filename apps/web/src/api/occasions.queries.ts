import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OccasionImportResult, OccasionInput, OccasionList, OccasionOrder, OccasionPack } from '@deadair/sdk';

import { saveJsonDownload } from '../components/shared/download';
import { sdk } from './client';
import { useListWrite } from './mutation.kit';
import { queryKeys } from './query.keys';

/** Every occasion, in the order a date is matched against them, each saying when it next falls. */
export function useOccasions() {
    return useQuery({
        queryKey: queryKeys.schedule.occasions(),
        queryFn: () => sdk.schedule.listOccasions(),
    });
}

/** Every occasion write answers the whole list, which is written straight into the cache. */
function useOccasionWrite<TArgs>(mutationFn: (args: TArgs) => Promise<OccasionList>) {
    return useListWrite(queryKeys.schedule.occasions(), mutationFn);
}

export function useAddOccasion() {
    return useOccasionWrite((occasion: OccasionInput) => sdk.schedule.addAnOccasion(occasion));
}

export function useChangeOccasion() {
    return useOccasionWrite(({ id, occasion }: { id: string; occasion: OccasionInput }) => sdk.schedule.changeAnOccasion(id, occasion));
}

export function useRemoveOccasion() {
    return useOccasionWrite((id: string) => sdk.schedule.removeAnOccasion(id));
}

export function useReorderOccasions() {
    return useOccasionWrite((order: OccasionOrder) => sdk.schedule.reorderOccasions(order));
}

/** Saves every occasion as a file. A download is not state this console holds, so this is no query. */
export async function exportOccasions(): Promise<void> {
    saveJsonDownload(await sdk.schedule.exportOccasions(), 'deadair-occasions.json');
}

export function usePreviewOccasionImport() {
    return useMutation({ mutationFn: (pack: OccasionPack) => sdk.schedule.previewOccasionImport(pack) });
}

/** An import answers the list as it now stands, beside what it did. */
export function useImportOccasions() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (pack: OccasionPack) => sdk.schedule.importOccasions(pack),
        onSuccess: (answer: OccasionImportResult) => {
            queryClient.setQueryData(queryKeys.schedule.occasions(), answer.list);
        },
    });
}
