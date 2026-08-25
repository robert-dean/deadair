import { queryOptions, useQuery } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long a chart stays fresh.
 *
 * Long, and it does not poll. A chart is a document somebody else publishes on their own schedule,
 * weekly on most services and daily at best, so re-asking on an interval would spend a plugin's
 * rate budget to redraw the same table. The rest of this console polls because the station moves
 * underneath it; this page is the one surface where nothing does.
 */
const CHART_STALE_TIME = 15 * 60_000;

export const chartsListOptions = queryOptions({
    queryKey: queryKeys.charts.list(),
    queryFn: () => sdk.charts.listCharts(),
    staleTime: CHART_STALE_TIME,
});

/** Every chart the installed plugins offer. An empty list is a station with no chart plugin on. */
export function useCharts() {
    return useQuery(chartsListOptions);
}

export function chartPageOptions(id: string, date?: string) {
    return queryOptions({
        queryKey: queryKeys.charts.page(id, date),
        queryFn: () => sdk.charts.readChart(id, date === undefined ? {} : { date }),
        staleTime: CHART_STALE_TIME,
    });
}

/**
 * One chart's records, ranked.
 *
 * `enabled` rather than a conditional hook, because which chart is being shown is a choice the page
 * makes after it has read the list, and there is no chart to ask for until it has.
 */
export function useChart(id: string | undefined) {
    return useQuery({ ...chartPageOptions(id ?? ''), enabled: id !== undefined });
}
