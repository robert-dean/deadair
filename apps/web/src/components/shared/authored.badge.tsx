import { Badge, type BadgeProps } from '@mantine/core';
import type { ReactNode } from 'react';

export interface AuthoredBadgeProps extends Omit<BadgeProps, 'color' | 'variant'> {
    /** Whether the station wrote what this labels. `false` draws it in the neutral grey a person's work gets. */
    authored?: boolean;
    children?: ReactNode;
}

/**
 * The label on something the STATION authored: a break, a talk-over, a model's writing.
 *
 * `grape` in the light variant is that mark everywhere (see `theme.ts`), and about twenty badges wrote
 * it out by hand. Only the colour and the variant are fixed here; size, case and layout pass through,
 * because a badge in a table row and one on the desk sit differently. `authored={false}` is for a row
 * that may be a person's instead, which takes the neutral grey.
 */
export function AuthoredBadge({ authored = true, children, ...badge }: AuthoredBadgeProps) {
    return (
        <Badge variant="light" color={authored ? 'grape' : 'gray'} {...badge}>
            {children}
        </Badge>
    );
}
