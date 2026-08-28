import { useQuery } from '@tanstack/react-query';
import type { ConfigFieldDescriptor, ConfigFieldOption, ConfigFieldOptionSource } from '@deadair/sdk';

import { topicsOptions } from '../../api/topics.queries';

/** The `news` kind, as `segments.kind` spells it. The one kind whose subjects are offered as choices today. */
const NEWS_KIND = 'news';

/**
 * The suggestion key a column's choices are published under: the field's key and the column's.
 *
 * Two levels, because a field key is not enough to name a cell — a `list` has as many inputs per row
 * as it has columns. A dot is safe as the separator for the reason a column key may not contain one
 * (`ConfigFieldColumn.key` in the plugin SDK), so this cannot collide with a field key that has dots
 * of its own, which every station setting does.
 */
export const columnSuggestionKey = (fieldKey: string, columnKey: string): string => `${fieldKey}.${columnKey}`;

/**
 * The choices a column declared `optionsFrom` for, resolved against the station's own tables.
 *
 * The third of the three ways a settings form learns what to offer, and the only one the SERVER
 * cannot answer: `options` is what the plugin decided when its manifest was written,
 * `suggestConfigOptions()` is what the operator's own upstream currently says, and this is what the
 * STATION says. A plugin has no way to ask — a news plugin cannot learn which categories this
 * station holds — so a feed that wants to name one would otherwise be a free-text cell where
 * `sports` and `sport` are a silent miss, visible only as bulletins declining weeks later.
 *
 * Answered in the shape the form already merges (suggestions keyed by input), so a resolved source
 * and a plugin's own answer arrive by one route and neither call site grows its own copy.
 *
 * A FIELD may name one as well as a column, which is what lets the station's timezone offer the
 * zones this browser actually knows: it was free text whose typo did not fail until the first break
 * tried to speak the time, because `stationZone` deliberately lets `Intl.DateTimeFormat` throw on
 * `Europe/Lundon` rather than quietly reporting the server's hour for a month.
 *
 * Nothing is fetched for a form that declares no source, and the zone list costs no request at all.
 */
export function useDeclaredOptions(fields: readonly ConfigFieldDescriptor[]): Record<string, readonly ConfigFieldOption[]> {
    const wanted = declaredSources(fields);
    const topics = useQuery({ ...topicsOptions, enabled: wanted.has('station.newsCategories') });

    if (wanted.size === 0) return {};

    const answers: Record<ConfigFieldOptionSource, readonly ConfigFieldOption[]> = {
        'station.newsCategories': (topics.data?.topics ?? [])
            .filter(topic => topic.kind === NEWS_KIND)
            .map(topic => ({ value: topic.key, label: topic.label })),
        // No query and no round trip: the platform holds this list, and the browser's copy is the
        // one that matters — a zone the operator's own machine cannot name is a zone they cannot
        // check the clock against. `supportedValuesOf` is ES2022 and has been in every engine this
        // console runs on for years, but it is guarded anyway, since the answer for a browser
        // without it is a field with no suggestions rather than a settings page that will not draw.
        'intl.timeZones': zoneOptions(),
    };

    const resolved: Record<string, readonly ConfigFieldOption[]> = {};
    for (const field of fields) {
        // A FIELD may name a source, and so may each of its columns. Both land in the same map,
        // under the key the form looks each input up by, so `optionsFor` and `columnOptionsFor`
        // merge one shape and neither knows a second kind of source exists.
        if (field.optionsFrom !== undefined) resolved[field.key] = answers[field.optionsFrom];
        for (const column of field.columns ?? []) {
            if (column.optionsFrom !== undefined) resolved[columnSuggestionKey(field.key, column.key)] = answers[column.optionsFrom];
        }
    }

    return resolved;
}

/**
 * Every IANA zone this browser knows, each labelled as itself.
 *
 * Not relabelled into anything friendlier: the VALUE is what the station stores and what
 * `stationZone` hands to `Intl.DateTimeFormat`, so a list showing "London" for `Europe/London`
 * would be a menu whose entries do not match the thing being configured. Sorted because
 * `supportedValuesOf` is specified to answer sorted and an unsorted engine would be a scroll.
 */
function zoneOptions(): ConfigFieldOption[] {
    if (typeof Intl.supportedValuesOf !== 'function') return [];
    return Intl.supportedValuesOf('timeZone').map(zone => ({ value: zone, label: zone }));
}

/** Every source this form asks for, so nothing is read for a form that asks for none. */
function declaredSources(fields: readonly ConfigFieldDescriptor[]): ReadonlySet<ConfigFieldOptionSource> {
    const sources = new Set<ConfigFieldOptionSource>();
    for (const field of fields) {
        if (field.optionsFrom !== undefined) sources.add(field.optionsFrom);
        for (const column of field.columns ?? []) {
            if (column.optionsFrom !== undefined) sources.add(column.optionsFrom);
        }
    }
    return sources;
}
