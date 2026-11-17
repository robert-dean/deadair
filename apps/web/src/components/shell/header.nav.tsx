import { Badge, Button, Group } from '@mantine/core';
import type { AttentionItem } from '@deadair/sdk';
import { Link, useRouterState } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { severityColor } from '../shared/status';
import { attentionAcross, attentionCounts, type AttentionCount } from './attention.destination';
import { isInsideDestination, NAV_DESTINATIONS, NAV_FOOTER_DESTINATIONS, type NavDestination } from './destinations';

export interface HeaderNavProps {
    /** What wants somebody, from the query the shell already polls. */
    attention: readonly AttentionItem[] | undefined;
}

/**
 * The four destinations, as tabs across the header.
 *
 * They were rows down a rail that also listed every section of the destination you were in, which is
 * what made it tall enough to fight itself: Settings' 22 sections squeezed the destinations above
 * them. The sections are now each destination's own tab strip, under its title, so the header only
 * has to say where you are and how to get to the other three.
 *
 * Each tab carries everything waiting anywhere in its destination, since the tab stands for all of
 * it. The letters are the keys the shell binds (d, p, l, v); they are in each tab's title rather than
 * drawn, because four keycaps in a header is chrome an operator learns once and never reads again.
 */
export function HeaderDestinations({ attention }: HeaderNavProps) {
    const counts = useCounts(attention);
    return (
        <Group component="nav" gap={2} wrap="nowrap" visibleFrom="sm" aria-label={useTranslation('shell').t('headerNav.label')}>
            {NAV_DESTINATIONS.map(destination => (
                <HeaderLink key={destination.to as string} destination={destination} count={attentionAcross(counts, destination)} />
            ))}
        </Group>
    );
}

/**
 * Check-up and Settings, pinned at the right of the header.
 *
 * Apart from the four because they are not where the broadcast is run: one says how the machinery is,
 * the other changes it. Hidden on a phone, where the menu in the corner holds them.
 */
export function HeaderPinned({ attention }: HeaderNavProps) {
    const counts = useCounts(attention);
    return (
        <Group gap={2} wrap="nowrap" visibleFrom="sm">
            {NAV_FOOTER_DESTINATIONS.map(destination => (
                <HeaderLink key={destination.to as string} destination={destination} count={attentionAcross(counts, destination)} />
            ))}
        </Group>
    );
}

function useCounts(attention: readonly AttentionItem[] | undefined): ReadonlyMap<string, AttentionCount> {
    return useMemo(() => attentionCounts(attention ?? []), [attention]);
}

function HeaderLink({ destination, count }: { destination: NavDestination; count: AttentionCount | undefined }) {
    const { t } = useTranslation('shell');
    const pathname = useRouterState({ select: state => state.location.pathname });
    const active = isInsideDestination(destination, pathname);

    return (
        <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            fw={active ? 600 : 400}
            c={active ? 'var(--da-text)' : 'var(--da-text-secondary)'}
            bg={active ? 'var(--da-raised)' : undefined}
            aria-current={active ? 'page' : undefined}
            aria-label={count ? t('navItem.attention', { label: destination.label, count: count.count }) : undefined}
            title={destination.hint === undefined ? undefined : t('headerNav.key', { key: destination.hint.toLowerCase() })}
            rightSection={
                count ? (
                    <Badge aria-hidden size="sm" circle variant="filled" color={severityColor[count.severity]}>
                        {count.count}
                    </Badge>
                ) : undefined
            }
            // Annotated for the reason every `renderRoot` here is: Mantine hands back `any`, and
            // spreading an `any` into a `Link` switches off the check that `to` is a route.
            renderRoot={(props: object) => <Link to={destination.to} search={destination.search} {...props} />}
        >
            {destination.label}
        </Button>
    );
}
