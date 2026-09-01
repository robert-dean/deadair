import type { KeyboardEvent, ReactNode } from 'react';
import { Box, Card, Group, Stack } from '@mantine/core';

export interface PhoneCardProps {
    /**
     * What the row is recognised by: artwork, a rank, a moment. Rendered shrink-proof, so a long
     * title truncates before the thing that identifies the row does.
     */
    leading?: ReactNode;
    /**
     * The first line. The card supplies the `minWidth: 0` chain that makes truncation possible at
     * all; the caller supplies the link or text, with `truncate` on whatever should give way.
     */
    title: ReactNode;
    /** The second line, on the same terms as {@link title}. Dimming is the call site's choice. */
    subtitle?: ReactNode;
    /**
     * The right-hand figure — a duration, a spend. Rendered shrink-proof; the caller applies
     * `.da-num` so the column of them does not twitch.
     */
    figure?: ReactNode;
    /** Trailing touch target(s). The caller sizes them for a thumb; 44px is the desk's precedent. */
    action?: ReactNode;
    /** Full-width content under the main line: a rating row, an expansion. */
    below?: ReactNode;
    /**
     * A whole-card tap, for rows whose job is to open something. Adds the button role, keyboard
     * reach and the pointer cursor, rather than leaving those to each caller to remember.
     */
    onClick?: () => void;
    /** An accessible name for the tap, since the card's contents are fragments rather than a label. */
    'aria-label'?: string;
    /**
     * A raised surface with an inset bar in this colour, for the one card in a stack that is
     * happening now. E.g. `var(--mantine-color-red-6)` on the airing record.
     */
    accent?: string;
    /** How loud the card is; the running order reads history at half weight. */
    opacity?: number;
    /** Indent steps, for rows that are a tree (traces). One step is 12px; depth is not a pixel count. */
    depth?: number;
}

/**
 * One row of a data table, on a phone.
 *
 * Deliberately not a table row with columns hidden. What survives a 375px width is a different
 * SELECTION, not a narrower one, and that selection belongs to each page: this card only owns the
 * skeleton those selections share — a shrink-proof leading slot, two truncating lines, a figure on
 * the right, a touch target on the end. Extracted from the desk's running order, which shipped the
 * shape first; the load-bearing part is the `minWidth: 0` chain, without which nothing truncates
 * and the longest title decides the page's width.
 */
export function PhoneCard({
    leading,
    title,
    subtitle,
    figure,
    action,
    below,
    onClick,
    'aria-label': ariaLabel,
    accent,
    opacity,
    depth,
}: PhoneCardProps) {
    const onKeyDown = onClick
        ? (event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onClick();
              }
          }
        : undefined;

    return (
        <Card
            withBorder={false}
            padding="xs"
            radius="sm"
            opacity={opacity}
            ml={depth ? depth * 12 : undefined}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            aria-label={onClick ? ariaLabel : undefined}
            onClick={onClick}
            onKeyDown={onKeyDown}
            style={{
                background: accent ? 'var(--da-raised)' : 'transparent',
                boxShadow: accent ? `inset 3px 0 0 ${accent}` : undefined,
                cursor: onClick ? 'pointer' : undefined,
            }}
        >
            <Group gap="sm" wrap="nowrap">
                {/* The shrink-proofing is here rather than at each call site, because it is the
                    card's promise: the slots that identify and measure the row hold their width,
                    and the two text lines are the only things that give way. */}
                {leading ? <Box style={{ flexShrink: 0 }}>{leading}</Box> : undefined}
                <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                        {title}
                    </Group>
                    {subtitle ? (
                        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                            {subtitle}
                        </Group>
                    ) : undefined}
                </Stack>
                {figure ? <Box style={{ flexShrink: 0 }}>{figure}</Box> : undefined}
                {action ? <Box style={{ flexShrink: 0 }}>{action}</Box> : undefined}
            </Group>
            {below}
        </Card>
    );
}
