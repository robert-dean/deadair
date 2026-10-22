import type { ReactNode } from 'react';

import { ErrorAlert } from './error.alert';

export interface QueryViewProps<T> {
    /** The query, or anything shaped like one: only what it has, whether it failed and whether it is still coming. */
    query: { data: T | undefined; error: unknown; isPending: boolean };
    /** What stands in while the first answer is coming, usually a `PageSkeleton`. */
    skeleton: ReactNode;
    /** What failed, in the console's words, as `ErrorAlert` takes them. */
    errorTitle: string;
    errorFallback: string;
    /** Whether an answer has nothing in it to draw. Without it, every answer is drawn. */
    isEmpty?: (data: T) => boolean;
    /** What an empty answer says instead, usually an `EmptyState`; a function when it reads the answer (the reason it is empty, say). */
    empty?: ReactNode | ((data: T) => ReactNode);
    /** The answer, drawn. */
    children: (data: T) => ReactNode;
}

/**
 * A query's four states, in the order every page here draws them: the failure, the skeleton, then
 * the empty answer or the answer itself.
 *
 * The four pieces already existed (`ErrorAlert`, `PageSkeleton`, `EmptyState` and the page's own
 * content) and were composed by hand the same way on page after page. One rule in that composition
 * is worth keeping deliberately: **a failure and an answer can show together.** A refetch that fails
 * leaves the last answer in the cache, and the page keeps drawing it under the alert rather than
 * blanking a list the operator was reading.
 *
 * Draws no `Card` or frame of its own, so the page's layout stays the page's; see `apps/web/CLAUDE.md`
 * on wrappers.
 */
export function QueryView<T>({ query, skeleton, errorTitle, errorFallback, isEmpty, empty, children }: QueryViewProps<T>) {
    const { data, error, isPending } = query;

    return (
        <>
            {error ? <ErrorAlert title={errorTitle} error={error} fallback={errorFallback} /> : undefined}
            {isPending ? skeleton : undefined}
            {data === undefined ? undefined : isEmpty?.(data) ? (typeof empty === 'function' ? empty(data) : empty) : children(data)}
        </>
    );
}
