import { Anchor, Blockquote, Stack, Text } from '@mantine/core';
import type { SegmentSource } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { useSegmentSources } from '../../api/scripts.queries';
import { Eyebrow } from '../shared/eyebrow';

/**
 * The plugin id every rendered segment airs under, which is how a playout item is known to be a break.
 *
 * The API's `RENDER_PLUGIN_ID` (`render/segment.source.ts`); the contract carries the id as text, so
 * this is the one place the console spells it.
 */
export const RENDER_PLUGIN_ID = 'deadair.render';

export interface BreakSourcesProps {
    segmentId: string;
    /**
     * Only what the words said, for a place that shows a break while it airs. The detail panel shows
     * the rest as well, because what a break was handed and ignored is part of why it came out as it did.
     */
    saidOnly?: boolean;
}

/**
 * Where a break's facts came from: each stored fact its writer was handed, the page it was taken from
 * and the words there that state it.
 *
 * Whether a fact was said is the station's own read-back, never the model's word, and it errs towards
 * "not said". So the split this draws is "said" against "handed, not said", and a fact in the second
 * group may still have been paraphrased past what the read-back can see.
 *
 * Draws nothing at all while loading, on a failure, or for a break handed no stored fact, which is most
 * of them: an empty heading under every break would be noise, and a failure here costs a footnote.
 */
export function BreakSources({ segmentId, saidOnly = false }: BreakSourcesProps) {
    const { t } = useTranslation('scripts');
    const sources = useSegmentSources(segmentId);

    const all = sources.data?.sources ?? [];
    const said = all.filter(source => source.told);
    const unsaid = saidOnly ? [] : all.filter(source => !source.told);
    if (said.length === 0 && unsaid.length === 0) return undefined;

    return (
        <Stack gap="xs">
            {said.length === 0 ? undefined : (
                <Stack gap="xxs">
                    <Eyebrow>{t('sources.said')}</Eyebrow>
                    {said.map((source, index) => (
                        <Source key={index} source={source} />
                    ))}
                </Stack>
            )}
            {unsaid.length === 0 ? undefined : (
                <Stack gap="xxs">
                    <Eyebrow>{t('sources.unsaid')}</Eyebrow>
                    {unsaid.map((source, index) => (
                        <Source key={index} source={source} muted />
                    ))}
                </Stack>
            )}
        </Stack>
    );
}

/** One fact, the span that states it and where that span is. Every word of it is the station's or the page's, shown as it came. */
function Source({ source, muted = false }: { source: SegmentSource; muted?: boolean }) {
    const { t } = useTranslation('scripts');

    return (
        <Stack gap={4} style={{ maxWidth: 640 }}>
            <Text size="sm" c={muted ? 'dimmed' : undefined}>
                {source.claim}
            </Text>
            <Blockquote p="xs" fz="xs" c="dimmed" iconSize={0} style={{ borderInlineStartWidth: 2 }}>
                {source.sourceQuote}
            </Blockquote>
            <Anchor href={source.sourceUrl} target="_blank" rel="noreferrer noopener" size="xs">
                {t('sources.link', { provider: source.sourceProvider })}
            </Anchor>
        </Stack>
    );
}
