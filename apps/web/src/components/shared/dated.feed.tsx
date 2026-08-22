import { type ReactNode } from 'react';
import { Box, Card, Stack, Text, Tooltip } from '@mantine/core';

import { formatMomentFull, formatMomentStamp } from './feed.moment';

/** The two things this needs of a row to place it: which one it is, and when it happened. */
export interface DatedFeedItem {
    id: string;
    at: string;
}

export interface DatedFeedProps<T extends DatedFeedItem> {
    /** Newest first, as both feeds' APIs send them. */
    items: T[];
    /** One row's content. The rule above and the separator below it are not this function's problem. */
    children: (item: T) => ReactNode;
}

/**
 * A list of things that happened, newest first.
 *
 * The activity feed and the script history are the same object twice: a `Card` with no padding, a
 * flat stack of rows and a rule between them. Both built it themselves, and the second one's
 * `DayHeading` carried a docstring reading "as on the activity feed and for the same reason" — which
 * is the state a component is extracted FROM.
 *
 * The division of labour is the useful part. This owns where a rule goes; the caller owns what a row
 * says. That is why rows no longer take a `first` prop: both pages had to thread `index === 0` down
 * into their row component and repeat the border expression there, so a row knew about its
 * neighbours in order to draw a line above itself. The separator belongs to the list, so the list
 * draws it.
 *
 * It used to break by calendar day, with a heading wherever the day changed, because the time column
 * carried no date and a list spanning midnight read as one very long evening. `FeedMoment` carries
 * the date itself now, so every row stands on its own and the heading was saying it twice.
 */
export function DatedFeed<T extends DatedFeedItem>({ items, children }: DatedFeedProps<T>) {
    return (
        <Card padding={0}>
            <Stack gap={0}>
                {items.map((item, index) => (
                    <FeedRule key={item.id} first={index === 0}>
                        {children(item)}
                    </FeedRule>
                ))}
            </Stack>
        </Card>
    );
}

/** A hairline above everything but the top of the list, so the card's own border is not doubled. */
function FeedRule({ first, children }: { first: boolean; children: ReactNode }) {
    return <Box style={{ borderTop: first ? undefined : '1px solid var(--da-border)' }}>{children}</Box>;
}

/**
 * When a row happened, in the left-hand column: the date and the wall-clock time, in the operator's
 * own zone.
 *
 * `.da-num` because these stack into a column that would otherwise twitch, `nowrap` because it must
 * never be what wraps, and the full date behind a tooltip because the column abbreviates the month
 * and drops the year.
 */
export function FeedMoment({ at }: { at: string }) {
    return (
        <Tooltip label={formatMomentFull(at)} openDelay={300}>
            <Text size="xs" c="dimmed" className="da-num" style={{ whiteSpace: 'nowrap' }}>
                {formatMomentStamp(at)}
            </Text>
        </Tooltip>
    );
}
