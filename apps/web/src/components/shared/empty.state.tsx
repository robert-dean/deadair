import type { ReactNode } from 'react';
import { Card, Stack, Text } from '@mantine/core';

export interface EmptyStateProps {
    /** What is not here, stated plainly. */
    title: string;
    /** Why it is not here and what would change that. */
    children: ReactNode;
    /** A way out, when there is one worth putting under the sentence. */
    action?: ReactNode;
}

/**
 * A place with nothing in it yet, which is not the same as a place that is broken.
 *
 * Two rules the nine hand-rolled copies disagreed about. The measure is capped, because a single
 * dimmed sentence run across a 1600px console is unreadable and half the copies knew that. And an
 * empty state always says what would FILL it: "no plugins are mounted" is a fact, and the sentence
 * under it is the only part an operator can act on.
 */
export function EmptyState({ title, children, action }: EmptyStateProps) {
    return (
        <Card padding="xl">
            <Stack gap="xs" align="flex-start">
                <Text fw={600}>{title}</Text>
                <Text size="sm" c="dimmed" maw={520}>
                    {children}
                </Text>
                {action}
            </Stack>
        </Card>
    );
}
