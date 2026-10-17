import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { rangeWindow, type TrendRange } from '../components/trends/trends.data';
import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How often a trend is re-read.
 *
 * A minute, because that is how often the station writes one: reading faster would fetch the same
 * rows again. Foreground only, like Check-up: nothing here drives a badge.
 */
const TRENDS_POLL_MS = 60_000;

/**
 * The given metrics over a range ending now.
 *
 * Keyed on the range and the names, not on the instant: the window is worked out when the request is
 * made, so each poll reads up to the minute it runs in without becoming a new cache entry. The
 * previous range's answer stays on screen while a new range loads, so switching ranges does not
 * blank the charts.
 */
export function useMetricSeries(names: readonly string[], range: TrendRange, enabled = true) {
    return useQuery({
        queryKey: queryKeys.metrics.series(names, range),
        queryFn: () => {
            const { from, to } = rangeWindow(range);
            return sdk.metrics.readMetricSeries({ names: names.join(','), from, to });
        },
        refetchInterval: TRENDS_POLL_MS,
        staleTime: TRENDS_POLL_MS,
        placeholderData: keepPreviousData,
        enabled,
    });
}
