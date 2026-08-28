import { Box, Button, Group } from '@mantine/core';

export interface DestinationTab<TKey extends string> {
    key: TKey;
    label: string;
    /** How many things on this tab want somebody, if any. Zero draws nothing. */
    attention?: number;
}

export interface DestinationTabsProps<TKey extends string> {
    tabs: readonly DestinationTab<TKey>[];
    active: TKey;
    onSelect: (key: TKey) => void;
    /** Named for the screen reader, because a page can carry more than one of these. */
    label: string;
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
 */
export function DestinationTabs<TKey extends string>({ tabs, active, onSelect, label }: DestinationTabsProps<TKey>) {
    return (
        <Group
            gap={2}
            wrap="wrap"
            role="tablist"
            aria-label={label}
            // The rule the tabs sit ON, so the selected one reads as connected to what is below it
            // rather than as a pill floating above a panel.
            style={{ borderBottom: '1px solid var(--da-border)' }}
        >
            {tabs.map(tab => {
                const selected = tab.key === active;
                return (
                    <Button
                        key={tab.key}
                        role="tab"
                        aria-selected={selected}
                        variant="subtle"
                        color="gray"
                        radius={0}
                        size="compact-md"
                        fw={selected ? 600 : 400}
                        c={selected ? 'var(--da-text)' : 'var(--da-text-secondary)'}
                        onClick={() => onSelect(tab.key)}
                        rightSection={tab.attention ? <Box aria-hidden w={6} h={6} bg="yellow.4" style={{ borderRadius: '50%' }} /> : undefined}
                        style={{
                            // Drawn as a border rather than a pseudo-element so it lands ON the
                            // strip's own rule instead of a pixel above it.
                            borderBottom: `2px solid ${selected ? 'var(--da-phosphor)' : 'transparent'}`,
                            marginBottom: -1,
                        }}
                    >
                        {tab.label}
                    </Button>
                );
            })}
        </Group>
    );
}
