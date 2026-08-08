import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../api/query.keys';
import { sdkError } from '../../api/sdk.error';

/** What a refused edit means, said as the thing that actually happened rather than as a status code. */
export const STALE_LINEUP_MESSAGE =
    'The lineup changed while you were looking at it, so that edit was refused rather than applied to whatever is now in that position. The order below is the station’s.';

export interface LineupEditGuard {
    /** Whether the last edit was refused for being made against an order that had moved on. */
    conflict: boolean;
    dismissConflict: () => void;
    /** Pass as an edit mutation's `onError`. Anything that is not a stale revision is left to the caller. */
    onError: (error: unknown) => void;
}

/**
 * The one place a stale revision is turned back into something an operator can act on.
 *
 * Every edit carries the revision the operator was looking at, and the API refuses one made against
 * an order that has since moved — appended to by the extend job, or committed from as tracks air.
 * That refusal is the console working, not failing, so it says what changed and re-reads the order
 * rather than leaving the operator staring at a list that is no longer true.
 *
 * Deliberately NOT used for delete, whose 409 means something else entirely: that the lineup is on
 * air. Re-reading the order would not help, and "it changed while you were looking at it" would be
 * a lie. That message comes from the API verbatim.
 */
export function useLineupEditGuard(lineupId: string): LineupEditGuard {
    const queryClient = useQueryClient();
    const [conflict, setConflict] = useState(false);

    const onError = useCallback(
        (error: unknown) => {
            if (sdkError(error)?.status !== 409) return;
            setConflict(true);
            void queryClient.refetchQueries({ queryKey: queryKeys.director.lineup(lineupId) });
        },
        [queryClient, lineupId],
    );

    const dismissConflict = useCallback(() => {
        setConflict(false);
    }, []);

    return { conflict, dismissConflict, onError };
}
