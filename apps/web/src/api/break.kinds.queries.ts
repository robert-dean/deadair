import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BreakKindFile, BreakKindImportPlan, BreakKindImportResult, BreakKindInput, BreakKindList } from '@deadair/sdk';

import { downloadFilename, saveJsonDownload } from '../components/shared/download';
import { sdk } from './client';
import { useListWrite } from './mutation.kit';
import { queryKeys } from './query.keys';

/**
 * How long the kinds of break an operator writes stay fresh.
 *
 * The topics' reasoning: these move when an operator moves them, every write answers with the whole
 * list and is written straight into the cache, and the only invisible writer is somebody editing the
 * table by hand.
 */
const BREAK_KINDS_STALE_TIME = 30_000;

export const breakKindsOptions = queryOptions({
    queryKey: queryKeys.director.breakKinds(),
    queryFn: () => sdk.director.listBreakKinds(),
    staleTime: BREAK_KINDS_STALE_TIME,
});

/** Every kind of break the operator has written, switched on or not. */
export function useBreakKinds() {
    return useQuery(breakKindsOptions);
}

/** Every write, sharing one success path: the answer is the whole list, so nothing refetches. */
function useBreakKindWrite<TArgs>(mutationFn: (args: TArgs) => Promise<BreakKindList>) {
    // Switching a kind on or off changes which kinds the format clock can produce, which the schedule
    // page draws from the clock's own answer. Invalidated rather than written, since this answer says
    // nothing about bands.
    return useListWrite(queryKeys.director.breakKinds(), mutationFn, [queryKeys.director.clock()]);
}

export const useCreateBreakKind = () => useBreakKindWrite((body: BreakKindInput) => sdk.director.createBreakKind(body));

export const useUpdateBreakKind = () =>
    useBreakKindWrite(({ id, body }: { id: string; body: BreakKindInput }) => sdk.director.updateBreakKind(id, body));

export const useDeleteBreakKind = () => useBreakKindWrite((id: string) => sdk.director.deleteBreakKind(id));

/**
 * Save the kinds to the operator's disk: one of them, or all of them. A plain function rather than a
 * mutation, on `exportPersonas`' rule: the result is a file rather than state this app holds, and the
 * filename is the server's, off `Content-Disposition`.
 */
export async function exportBreakKinds(id?: string): Promise<void> {
    const { data, headers } = id === undefined ? await sdk.director.exportBreakKinds() : await sdk.director.exportBreakKind(id);

    saveJsonDownload(data, downloadFilename(headers.contentDisposition, id === undefined ? 'break-kinds.json' : `${id}.json`));
}

/** What a file would do here. Writes nothing, so it touches no cache. */
export const usePreviewBreakKindImport = () =>
    useMutation<BreakKindImportPlan, Error, { file: BreakKindFile; replace: string[] }>({
        mutationFn: ({ file, replace }) => sdk.director.previewBreakKindImport(file, replace.length === 0 ? undefined : { replace }),
    });

/**
 * Write a file into the station. `replace` names the kinds already here the operator chose to rewrite;
 * every other one already here is skipped, which is the API's default, so nothing is overwritten by
 * forgetting to ask.
 */
export function useImportBreakKinds() {
    const queryClient = useQueryClient();
    return useMutation<BreakKindImportResult, Error, { file: BreakKindFile; replace: string[] }>({
        mutationFn: ({ file, replace }) => sdk.director.importBreakKinds(file, replace.length === 0 ? undefined : { replace }),
        onSuccess: result => {
            queryClient.setQueryData<BreakKindList>(queryKeys.director.breakKinds(), { kinds: result.kinds });
            // A rewritten kind is switched off, which changes what the clock can produce.
            void queryClient.invalidateQueries({ queryKey: queryKeys.director.clock() });
        },
    });
}
