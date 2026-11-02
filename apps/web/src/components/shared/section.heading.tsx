import type { ReactNode } from 'react';
import { Stack, Text, Title } from '@mantine/core';

export interface SectionHeadingProps {
    /** What the section is called. */
    title: ReactNode;
    /** What it is for, in a sentence or two, dimmed under the title. */
    description?: ReactNode;
    /** Set where the heading shares a row with a button, so the sentence wraps before it reaches it. */
    maw?: number;
}

/**
 * The heading that opens a section of a page or a card.
 *
 * Settings wrote this out card after card, always the same `h2` drawn at `h4` size and the same small
 * dimmed sentence under it. `order` and `size` differ on purpose: the page's own title is the
 * `h1`, so a section is a level two for a screen reader, and it is drawn smaller than a level two
 * would be because a console is dense and the page title has to stay the loudest thing on it.
 *
 * Draws no `Card` or frame of its own, so the card stays the page's; see `apps/web/CLAUDE.md` on
 * wrappers. With no description it is the `Title` alone, so whatever spacing the parent set is the
 * spacing below it.
 */
export function SectionHeading({ title, description, maw }: SectionHeadingProps) {
    const heading = (
        <Title order={2} size="h4">
            {title}
        </Title>
    );
    if (description === undefined) return heading;

    return (
        <Stack gap="xxs" maw={maw}>
            {heading}
            <Text size="sm" c="dimmed">
                {description}
            </Text>
        </Stack>
    );
}
