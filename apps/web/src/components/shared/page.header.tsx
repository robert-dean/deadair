import type { ReactNode } from 'react';
import { Group, Stack, Title } from '@mantine/core';

import { Eyebrow } from './eyebrow';

export interface PageHeaderProps {
    title: ReactNode;
    /** The small mono legend above the title, naming what KIND of page this is. */
    eyebrow?: string;
    /** One line under the title. Kept short: it is orientation, not documentation. */
    description?: ReactNode;
    /** Buttons for this page, held on the title's own line. */
    actions?: ReactNode;
    /** Anything that belongs immediately under the description, such as a row of status badges. */
    children?: ReactNode;
}

/**
 * The top of a page: what this is, and what can be done to it.
 *
 * Twenty pages each built this out of a `Stack` and a `Title`, which is how the console ended up
 * with actions above the heading on some pages and beside it on others. Here the actions are
 * always on the title's line and always to the right, because on a desk the label and its control
 * belong together.
 */
export function PageHeader({ title, eyebrow, description, actions, children }: PageHeaderProps) {
    return (
        <Stack gap="xxs">
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : undefined}
            <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
                <Title order={1}>{title}</Title>
                {actions ? (
                    <Group gap="xs" wrap="nowrap">
                        {actions}
                    </Group>
                ) : undefined}
            </Group>
            {description}
            {children}
        </Stack>
    );
}
