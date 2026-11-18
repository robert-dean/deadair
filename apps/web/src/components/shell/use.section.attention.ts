import type { LinkProps } from '@tanstack/react-router';

import { useStationAttention } from '../../api/station.queries';
import { attentionCounts, attentionForDestination, type AttentionCount } from './attention.destination';

/** A destination as the attention walk needs it: its own path, and each section's, in tab order. */
export interface SectionPaths {
    to: LinkProps['to'];
    sections: readonly { to: LinkProps['to'] }[];
}

/**
 * How many things want somebody on each section of one destination, in the order its tabs are drawn.
 *
 * The same walk the header's tabs badge from, handed to a destination's tab strip, so a fault that
 * badges a section's tab and the header tab above it cannot disagree. It reads the attention query the
 * shell already polls, so a page asking for it adds no request.
 *
 * The page passes its own paths rather than this reading `destinations.ts`, because that table is
 * built FROM the pages' tab lists: importing it here closed a cycle through every destination page,
 * and Voice's tabs were read before they existed. A list not yet read is no counts at all.
 */
export function useSectionAttention(destination: SectionPaths): readonly (AttentionCount | undefined)[] {
    const { data } = useStationAttention(true);
    if (data === undefined) return [];
    return attentionForDestination(attentionCounts(data.items), destination, true).sections;
}
