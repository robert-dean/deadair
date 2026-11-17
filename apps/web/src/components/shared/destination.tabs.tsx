import { Fragment, useEffect, useRef, useState } from 'react';
import { Badge, Box, Button, Group, Text, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { severityColor, type Severity } from './status';
import classes from './destination.tabs.module.css';

export interface DestinationTab<TKey extends string> {
    key: TKey;
    label: string;
    /**
     * The heading its tabs sit under, for a destination with too many to scan. Tabs sharing one are
     * neighbours, and the strip draws the heading once, before the first of them.
     */
    group?: string;
    /**
     * What is behind this tab, in a sentence.
     *
     * Several tabs name a subject rather than a page — "Subjects", "Charts" and "Soundboard" say
     * nothing on their own — so the strip shows this as the tab's tooltip. It lives here beside the
     * label rather than in `shell/destinations.ts` for the reason the palette already imports these
     * tables rather than restating them: two lists of the same tabs are two lists that drift.
     */
    hint?: string;
}

/** How many things on one tab want somebody, and how bad the worst of them is. */
export interface TabAttention {
    count: number;
    severity: Severity;
}

export interface DestinationTabsProps<TKey extends string> {
    tabs: readonly DestinationTab<TKey>[];
    active: TKey;
    onSelect: (key: TKey) => void;
    /** Named for the screen reader, because a page can carry more than one of these. */
    label: string;
    /**
     * What wants somebody on each tab, in the order of `tabs`; `useSectionAttention` reads it. Absent
     * or a zero count draws nothing.
     */
    attention?: readonly (TabAttention | undefined)[];
}

/**
 * The tab strip under a destination's heading.
 *
 * Not Mantine's `Tabs`, and the reason is the URL. These tabs are places — `/voice?tab=segments` is
 * a link an operator sends themselves, lands on after a reload, and reaches from an attention row.
 * Mantine's component owns its own selected state and hands back a change event, which works, but
 * every consumer then keeps a second copy of the truth beside the router's. Here the router is the
 * only state: `active` comes from the search param and `onSelect` navigates.
 *
 * Buttons rather than anchors, deliberately. A tab is drawn from `tabs`, whose keys are a union the
 * destination declares, so an `<a href>` would need a route-typed link per tab and the union would
 * stop being the thing that guarantees the set is complete. The destination navigates on select.
 *
 * ## One row that scrolls, where this used to wrap
 *
 * Measured at 390px, which is a phone: Voice's eight tabs are 1121px of intrinsic width and wrapped
 * onto FOUR rows, and Settings' ten are 1298px and wrapped onto as many as five. That is 120–150px
 * of navigation standing above every page of those destinations, on the viewport with the least room
 * to give. Library and Check-up fit on one line and never wrapped, which is why this went unnoticed.
 *
 * **The console tried a scrolling strip before and abandoned it, and the reason does not apply
 * here.** The settings page had a `ScrollArea` of Mantine `Badge`s below `md`; a `Badge` is capped at
 * the width of its container and ellipsises its label, so the row rendered "A…", "Voi…", "Wa…", and
 * chips that cannot be told apart are worse than no strip at all. That was a property of `Badge`.
 * These are `Button`s, which have no such cap.
 *
 * Two things make the row honest about what it is hiding. The selected tab is scrolled into view, so
 * landing on the last tab does not show a strip that starts at the first; and the edge the content
 * continues past is faded, so a cut-off tab reads as more-to-see rather than as a tab that has been
 * truncated. Both are gated on the row actually overflowing.
 *
 * ## On every viewport
 *
 * It was drawn on a phone only, because a desk listed the same sections down the rail. The rail is
 * the thing being replaced by tabs in the header, so the strip is how a destination's sections are
 * reached everywhere. The scrolling and fading above are what make that safe on a desk too: Voice's
 * eleven tabs measured 1122px in a 964px column at a 1200px window, and that row now scrolls with
 * its far edge faded rather than claiming to fit.
 */
export function DestinationTabs<TKey extends string>({ tabs, active, onSelect, label, attention }: DestinationTabsProps<TKey>) {
    const { t } = useTranslation();
    const strip = useRef<HTMLDivElement>(null);

    // Which edges the row continues past, which is what decides whether it is faded. Both false is
    // a row that fits, and that is every destination on a desktop.
    const [beyond, setBeyond] = useState({ start: false, end: false });

    useEffect(() => {
        const element = strip.current;
        if (element === null) return;

        const measure = () => {
            // A pixel of slack at each end: a scroll position lands on a fraction often enough that
            // an exact comparison leaves the fade drawn over a row that has nothing more to show.
            setBeyond({
                start: element.scrollLeft > 1,
                end: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
            });
        };

        // Optional-called because jsdom does not implement it, and a test that rendered a
        // destination should not have to know that this component scrolls.
        const recentre = () => element.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });

        // Before measuring, so the first paint is already at the selected tab rather than scrolling
        // to it.
        recentre();
        measure();

        // Re-centred on a resize but NOT on a scroll, which is the whole of the difference between
        // the two handlers: a phone turned on its side re-lays the row out around a tab that may now
        // be off the end of it, and re-centring on scroll would drag the row back from under anybody
        // who moved it themselves.
        const relayout = () => {
            recentre();
            measure();
        };

        element.addEventListener('scroll', measure, { passive: true });
        window.addEventListener('resize', relayout);
        return () => {
            element.removeEventListener('scroll', measure);
            window.removeEventListener('resize', relayout);
        };
    }, [active, tabs]);

    // Drawn as a mask rather than as a gradient laid over the row, because the row scrolls under it
    // and a solid overlay would have to know the page's background to fake the fade.
    const fade = maskFor(beyond);

    return (
        // The rule the tabs sit ON, so the selected one reads as connected to what is below it rather
        // than as a pill floating above a panel. On the rail rather than on the strip: see the note
        // in `destination.tabs.module.css`.
        <Box className={classes.rail}>
            <Group
                ref={strip}
                className={classes.strip}
                gap={2}
                // One row that scrolls. Wrapping is what put four rows of navigation above Voice on
                // a phone.
                wrap="nowrap"
                role="tablist"
                aria-label={label}
                style={fade === undefined ? undefined : { maskImage: fade, WebkitMaskImage: fade }}
            >
                {tabs.map((tab, index) => {
                    const selected = tab.key === active;
                    const waiting = attention?.[index];
                    const count = waiting && waiting.count > 0 ? waiting : undefined;
                    // A heading wherever the group changes, so a long strip reads in the same runs
                    // the destination is organised in. Not a tab: it takes no focus and is skipped by
                    // the tablist's arrow keys.
                    const heading = tab.group !== undefined && tab.group !== tabs[index - 1]?.group ? tab.group : undefined;
                    return (
                        <Fragment key={tab.key}>
                            {heading === undefined ? undefined : (
                                <Text
                                    component="span"
                                    role="presentation"
                                    ff="monospace"
                                    size="xs"
                                    tt="uppercase"
                                    c="dimmed"
                                    className={classes.group}
                                    style={{ letterSpacing: 'var(--da-tracking-eyebrow)' }}
                                >
                                    {heading}
                                </Text>
                            )}
                            <Tooltip label={tab.hint} disabled={tab.hint === undefined} openDelay={500} withinPortal>
                                <Button
                                    role="tab"
                                    aria-selected={selected}
                                    aria-label={count ? t('destinationTabs.attention', { label: tab.label, count: count.count }) : undefined}
                                    variant="subtle"
                                    color="gray"
                                    radius={0}
                                    size="compact-md"
                                    fw={selected ? 600 : 400}
                                    c={selected ? 'var(--da-text)' : 'var(--da-text-secondary)'}
                                    onClick={() => onSelect(tab.key)}
                                    rightSection={
                                        count ? (
                                            <Badge aria-hidden size="sm" circle variant="filled" color={severityColor[count.severity]}>
                                                {count.count}
                                            </Badge>
                                        ) : undefined
                                    }
                                    style={{
                                        // Never squashed to make the row fit, which is what a flex item does
                                        // by default and what `wrap="nowrap"` turns loose: ten tabs in 326px
                                        // rendered as "S A F F V( V M S W F", one letter each. That is the
                                        // same unreadable row the old `Badge` strip produced, reached by a
                                        // different route — `Badge` capped its own width, and this is flex
                                        // shrinking. A row that cannot be read is worse than one that wraps,
                                        // so the tabs keep their width and the strip scrolls instead.
                                        flexShrink: 0,
                                        // Drawn as a border rather than a pseudo-element, and it meets the
                                        // rail's line because the strip sits directly on it. It used to be
                                        // pulled down onto that line by `marginBottom: -1`, which is a pixel
                                        // outside the strip's content box and is now clipped by the
                                        // `overflow-y` that scrolling one row costs — a 2px underline drawn
                                        // 1px thick, on the selected tab only.
                                        borderBottom: `2px solid ${selected ? 'var(--da-phosphor)' : 'transparent'}`,
                                    }}
                                >
                                    {tab.label}
                                </Button>
                            </Tooltip>
                        </Fragment>
                    );
                })}
            </Group>
        </Box>
    );
}

/** How far the fade reaches, which is about a tab's worth of one. */
const FADE = '24px';

/**
 * The mask for a row that continues past one edge, both, or neither.
 *
 * `undefined` for a row that fits, so the overwhelmingly common case sets no mask at all rather than
 * one that happens to be opaque end to end.
 */
function maskFor({ start, end }: { start: boolean; end: boolean }): string | undefined {
    if (!start && !end) return undefined;
    const from = start ? `transparent 0, black ${FADE}` : 'black 0';
    const to = end ? `black calc(100% - ${FADE}), transparent 100%` : 'black 100%';
    return `linear-gradient(to right, ${from}, ${to})`;
}
