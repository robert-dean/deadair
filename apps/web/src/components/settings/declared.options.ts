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
 * Nothing is fetched for a form that declares no source, which is every form but one today.
 */
export function useDeclaredOptions(fields: readonly ConfigFieldDescriptor[]): Record<string, readonly ConfigFieldOption[]> {
    const wanted = declaredSources(fields);
    const topics = useQuery({ ...topicsOptions, enabled: wanted.has('station.newsCategories') });

    if (!wanted.has('station.newsCategories')) return {};

    const categories = (topics.data?.topics ?? [])
        .filter(topic => topic.kind === NEWS_KIND)
        .map(topic => ({ value: topic.key, label: topic.label }));

    const resolved: Record<string, readonly ConfigFieldOption[]> = {};
    for (const field of fields) {
        for (const column of field.columns ?? []) {
            if (column.optionsFrom === 'station.newsCategories') resolved[columnSuggestionKey(field.key, column.key)] = categories;
        }
    }

    return resolved;
}

/** Every source this form asks for, so nothing is read for a form that asks for none. */
function declaredSources(fields: readonly ConfigFieldDescriptor[]): ReadonlySet<ConfigFieldOptionSource> {
    const sources = new Set<ConfigFieldOptionSource>();
    for (const field of fields) {
        for (const column of field.columns ?? []) {
            if (column.optionsFrom !== undefined) sources.add(column.optionsFrom);
        }
    }
    return sources;
}
